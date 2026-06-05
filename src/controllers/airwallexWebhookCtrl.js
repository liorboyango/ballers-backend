/**
 * Airwallex Webhook Controller
 *
 * Handles incoming Airwallex webhook events. The raw request body is required
 * for signature verification — this controller must only be used with the
 * `express.raw({ type: 'application/json' })` middleware (NOT express.json()).
 *
 * Supported events:
 *   - payment_intent.succeeded                       → 'paid', clear cart
 *   - payment_intent.cancelled / payment_attempt.failed / payment_intent.failed → 'payment_failed'
 *
 * Security:
 *   - Airwallex signature is verified via AIRWALLEX_WEBHOOK_SECRET before any
 *     business logic runs. Requests with invalid signatures are rejected 400.
 *   - Idempotency: if the order is already in the target status the handler
 *     returns 200 immediately without writing to Firestore.
 *
 * Response semantics:
 *   - 200 { received: true }  — event accepted (whether handled or ignored)
 *   - 400 { error }           — signature / payload validation error (do NOT retry blindly)
 *   - 500 { error }           — server-side failure; Airwallex will retry per its delivery policy
 */

'use strict';

const airwallex = require('../services/airwallex');
const { admin } = require('../services/db');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

// ─── Event type classification ───────────────────────────────────────────────
//
// Airwallex webhook event `name` field is dot-namespaced. We normalise to one
// of three buckets: 'succeeded' | 'failed' | 'unhandled'.

const SUCCEEDED_EVENT_TYPES = new Set([
  'payment_intent.succeeded',
  'payment_intent.captured',
]);

const FAILED_EVENT_TYPES = new Set([
  'payment_intent.cancelled',
  'payment_intent.canceled',
  'payment_intent.failed',
  'payment_intent.expired',
  'payment_attempt.failed',
  'payment_attempt.cancelled',
]);

/**
 * @param {string|undefined|null} eventType
 * @returns {'succeeded'|'failed'|'unhandled'}
 */
function classifyEventType(eventType) {
  if (!eventType) return 'unhandled';
  const t = String(eventType).toLowerCase();
  if (SUCCEEDED_EVENT_TYPES.has(t)) return 'succeeded';
  if (FAILED_EVENT_TYPES.has(t)) return 'failed';
  return 'unhandled';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pull the Airwallex Payment Intent object out of the event envelope.
 *
 * Airwallex events are shaped as:
 *   { id, name, account_id, data: { object: { ...payment intent... } }, created_at }
 * Some payloads place the object directly on `data`, so we fall back accordingly.
 *
 * @param {object} event
 * @returns {object|null}
 */
function extractPaymentIntent(event) {
  if (!event || typeof event !== 'object') return null;
  const data = event.data;
  if (data && typeof data === 'object') {
    if (data.object && typeof data.object === 'object') return data.object;
    if (data.id || data.amount !== undefined) return data;
  }
  if (event.id && (event.status !== undefined || event.amount !== undefined)) {
    return event;
  }
  return null;
}

/**
 * Find an order document by its airwallexPaymentIntentId field.
 *
 * @param {string} paymentIntentId
 * @returns {Promise<FirebaseFirestore.QueryDocumentSnapshot|null>}
 */
async function findOrderByPaymentIntentId(paymentIntentId) {
  const snap = await Order.collection()
    .where('airwallexPaymentIntentId', '==', paymentIntentId)
    .limit(1)
    .get();

  if (snap.empty) return null;
  return snap.docs[0];
}

/**
 * Update an order's status and record the Airwallex event id for audit.
 * Skips the write if the order is already in the desired status (idempotency).
 *
 * @param {FirebaseFirestore.DocumentSnapshot} orderDoc
 * @param {string} newStatus
 * @param {string} airwallexEventId
 * @returns {Promise<boolean>} true if updated, false if skipped (already in status)
 */
async function updateOrderStatus(orderDoc, newStatus, airwallexEventId) {
  const current = orderDoc.data();

  // Idempotency guard — do not overwrite a terminal status with the same value.
  if (current.status === newStatus) {
    logger.info(
      `Airwallex webhook idempotency: order ${orderDoc.id} already has status '${newStatus}'. ` +
      `Skipping update for event ${airwallexEventId}.`
    );
    return false;
  }

  const update = {
    status: newStatus,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (airwallexEventId) update.airwallexEventId = airwallexEventId;

  await orderDoc.ref.update(update);

  logger.info(
    `Order ${orderDoc.id} status updated: '${current.status}' → '${newStatus}' ` +
    `(airwallex event: ${airwallexEventId || 'unknown'})`
  );
  return true;
}

/**
 * Clear the cart for a given userId.
 * Silently succeeds if the cart document does not exist.
 *
 * @param {string} userId
 */
async function clearUserCart(userId) {
  try {
    const cartRef = Cart.docForUser(userId);
    const cartSnap = await cartRef.get();

    if (!cartSnap.exists) {
      logger.debug(`clearUserCart: no cart found for user ${userId} — nothing to clear.`);
      return;
    }

    await cartRef.update({
      items: [],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(`Cart cleared for user ${userId} after successful Airwallex payment.`);
  } catch (err) {
    // Cart clearing is best-effort — log but do not fail the webhook response.
    logger.error(`Failed to clear cart for user ${userId}: ${err.message}`);
  }
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

/**
 * Handle an Airwallex payment_intent.succeeded event.
 *
 * 1. Find the order associated with the Airwallex payment intent.
 * 2. Update order status to 'paid'.
 * 3. Clear the user's cart.
 *
 * @param {object} intent     Airwallex Payment Intent object from event.data.object
 * @param {string} eventId    Airwallex event id (for audit)
 */
async function handlePaymentSucceeded(intent, eventId) {
  const intentId = intent && intent.id;
  const userIdFromMetadata = intent && intent.metadata && intent.metadata.userId;

  logger.info(
    `Handling Airwallex payment_intent.succeeded: ${intentId} ` +
    `(userId: ${userIdFromMetadata || 'unknown'}, eventId: ${eventId})`
  );

  if (!intentId) {
    logger.warn(`Airwallex succeeded event ${eventId} has no payment intent id; nothing to do.`);
    return;
  }

  const orderDoc = await findOrderByPaymentIntentId(intentId);

  if (!orderDoc) {
    // The order may not exist yet if the frontend hasn't called POST /api/orders/create.
    // This is acceptable — the webhook is informational. Log and return.
    logger.warn(
      `Airwallex payment_intent.succeeded: no order found for airwallexPaymentIntentId ${intentId}. ` +
      `The order may be created shortly by the frontend.`
    );
    return;
  }

  await updateOrderStatus(orderDoc, 'paid', eventId);

  // Clear the user's cart — prefer the userId stored on the order itself,
  // fall back to the Airwallex payment intent metadata.
  const orderUserId = orderDoc.data().user || userIdFromMetadata;
  if (orderUserId) {
    await clearUserCart(orderUserId);
  } else {
    logger.warn(
      `Airwallex payment_intent.succeeded: cannot clear cart — userId not found on order ${orderDoc.id} ` +
      `or in Airwallex payment intent metadata.`
    );
  }
}

/**
 * Handle an Airwallex payment failure / cancellation event.
 *
 * Updates the order status to 'payment_failed' so the merchant and customer
 * can be notified and the order can be retried or cancelled.
 *
 * @param {object} intent  Airwallex Payment Intent object from event.data.object
 * @param {string} eventId Airwallex event id (for audit)
 */
async function handlePaymentFailed(intent, eventId) {
  const intentId = intent && intent.id;
  // Airwallex surfaces failure context across a few fields depending on cause.
  const failureMessage =
    (intent && (intent.failure_reason || intent.error_message)) ||
    (intent && intent.status ? `status=${intent.status}` : 'Unknown payment failure');

  logger.warn(
    `Handling Airwallex payment failure: ${intentId} (eventId: ${eventId}). ` +
    `Reason: ${failureMessage}`
  );

  if (!intentId) {
    logger.warn(`Airwallex failed event ${eventId} has no payment intent id; nothing to do.`);
    return;
  }

  const orderDoc = await findOrderByPaymentIntentId(intentId);

  if (!orderDoc) {
    logger.warn(
      `Airwallex payment failure: no order found for airwallexPaymentIntentId ${intentId}.`
    );
    return;
  }

  await updateOrderStatus(orderDoc, 'payment_failed', eventId);
}

// ─── Main Webhook Handler ────────────────────────────────────────────────────

/**
 * @route   POST /api/airwallex/webhook
 * @desc    Receive and process Airwallex webhook events.
 *          Must be mounted with express.raw({ type: 'application/json' })
 *          so that the raw body is available for signature verification.
 * @access  Public (Airwallex servers only — verified via HMAC signature)
 *
 * Response 200: { received: true }
 * Response 400: { error: string }  (invalid signature or malformed payload)
 * Response 500: { error: string }  (server error — Airwallex will retry)
 */
exports.handleWebhook = async (req, res) => {
  // ── 1. Validate configuration ──────────────────────────────────────────────
  if (!process.env.AIRWALLEX_WEBHOOK_SECRET) {
    logger.error(
      'AIRWALLEX_WEBHOOK_SECRET is not configured. ' +
      'Webhook events cannot be verified. Set this env variable.'
    );
    // Return 500 so Airwallex retries — this is a server misconfiguration.
    return res.status(500).json({
      error: 'Webhook secret not configured on server.',
    });
  }

  // ── 2. Verify Airwallex signature ──────────────────────────────────────────
  let event;
  try {
    // req.body must be the raw Buffer (express.raw middleware).
    event = airwallex.webhooks.constructEvent(req.body, req.headers);
  } catch (err) {
    // AppError carries an HTTP status; misconfiguration → 500, anything else → 400.
    const httpStatus = err instanceof AppError && err.statusCode === 500 ? 500 : 400;
    if (httpStatus === 500) {
      logger.error(`Airwallex webhook configuration error: ${err.message}`);
    } else {
      logger.warn(`Airwallex webhook signature verification failed: ${err.message}`);
    }
    return res.status(httpStatus).json({
      error: `Webhook signature verification failed: ${err.message}`,
    });
  }

  const eventId = (event && (event.id || event.event_id)) || 'unknown';
  const eventType = (event && (event.name || event.type)) || 'unknown';
  logger.info(`Airwallex webhook received: ${eventType} (id: ${eventId})`);

  // ── 3. Dispatch event to handler ───────────────────────────────────────────
  const verdict = classifyEventType(eventType);
  const intent = extractPaymentIntent(event);

  try {
    switch (verdict) {
      case 'succeeded':
        if (!intent) {
          logger.warn(
            `Airwallex ${eventType} (id: ${eventId}) has no payment intent data; ignoring.`
          );
          break;
        }
        await handlePaymentSucceeded(intent, eventId);
        break;

      case 'failed':
        if (!intent) {
          logger.warn(
            `Airwallex ${eventType} (id: ${eventId}) has no payment intent data; ignoring.`
          );
          break;
        }
        await handlePaymentFailed(intent, eventId);
        break;

      default:
        // Log unhandled events at debug level — Airwallex sends many event types
        // (refunds, payouts, disputes, etc.) that we do not consume here.
        logger.debug(`Unhandled Airwallex event type: ${eventType} (id: ${eventId})`);
        break;
    }
  } catch (err) {
    // Log the error and return 500 so Airwallex retries this delivery according
    // to its retry policy. The handlers above are idempotent (status guard +
    // payment-intent-id lookup) so retries are safe.
    logger.error(
      `Error processing Airwallex event ${eventType} (id: ${eventId}): ${err.message}`,
      { stack: err.stack }
    );
    return res.status(500).json({
      error: 'Internal server error while processing webhook event.',
    });
  }

  // ── 4. Acknowledge receipt ─────────────────────────────────────────────────
  // Airwallex requires a 2xx response promptly; otherwise the event is retried.
  res.status(200).json({ received: true });
};

// Internal exports for unit testing — not part of the public route surface.
exports._internal = {
  classifyEventType,
  extractPaymentIntent,
  findOrderByPaymentIntentId,
  updateOrderStatus,
  clearUserCart,
  handlePaymentSucceeded,
  handlePaymentFailed,
};
