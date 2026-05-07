/**
 * Rapyd Webhook Controller
 *
 * Handles incoming Rapyd webhook events. The raw request body is required
 * for signature verification — this controller must only be used with the
 * `express.raw({ type: 'application/json' })` middleware (NOT express.json()).
 *
 * Supported events (Rapyd may emit any of the following synonyms):
 *   - payment.SUCCEEDED  / PAYMENT_COMPLETED / PAYMENT_SUCCEEDED → 'paid', clear cart
 *   - payment.FAILED     / PAYMENT_FAILED                         → 'payment_failed'
 *
 * Security:
 *   - Rapyd signature is verified via RAPYD_WEBHOOK_SECRET before any
 *     business logic runs. Requests with invalid signatures are rejected 400.
 *   - Idempotency: if the order is already in the target status the handler
 *     returns 200 immediately without writing to Firestore.
 *
 * Response semantics:
 *   - 200 { received: true }  — event accepted (whether handled or ignored)
 *   - 400 { error }           — signature / payload validation error (Rapyd should NOT retry these blindly)
 *   - 500 { error }           — server-side failure; Rapyd will retry per its delivery policy
 */

'use strict';

const rapyd = require('../services/rapyd');
const { getDb, admin } = require('../services/db');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

// ─── Event type classification ───────────────────────────────────────────────
//
// Rapyd's webhook event `type` field has varied across API versions. We accept
// every documented spelling and normalise to one of three buckets:
//   'succeeded' | 'failed' | 'unhandled'

const SUCCEEDED_EVENT_TYPES = new Set([
  'PAYMENT_COMPLETED',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_CAPTURED',
  'payment.SUCCEEDED',
  'payment.succeeded',
  'payment.completed',
  'payment.captured',
]);

const FAILED_EVENT_TYPES = new Set([
  'PAYMENT_FAILED',
  'PAYMENT_DECLINED',
  'PAYMENT_CANCELED',
  'PAYMENT_CANCELLED',
  'PAYMENT_EXPIRED',
  'payment.FAILED',
  'payment.failed',
  'payment.payment_failed',
  'payment.declined',
  'payment.canceled',
  'payment.cancelled',
  'payment.expired',
]);

/**
 * @param {string|undefined|null} eventType
 * @returns {'succeeded'|'failed'|'unhandled'}
 */
function classifyEventType(eventType) {
  if (!eventType) return 'unhandled';
  const t = String(eventType);
  if (SUCCEEDED_EVENT_TYPES.has(t) || SUCCEEDED_EVENT_TYPES.has(t.toUpperCase()) ||
      SUCCEEDED_EVENT_TYPES.has(t.toLowerCase())) {
    return 'succeeded';
  }
  if (FAILED_EVENT_TYPES.has(t) || FAILED_EVENT_TYPES.has(t.toUpperCase()) ||
      FAILED_EVENT_TYPES.has(t.toLowerCase())) {
    return 'failed';
  }
  return 'unhandled';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Pull the Rapyd Payment object out of the event envelope.
 *
 * Rapyd events are typically shaped as:
 *   { id, type, data: { ...payment object... }, ... }
 * but some sandbox payloads put the payment directly on the root, so we
 * fall back accordingly.
 *
 * @param {object} event
 * @returns {object|null}
 */
function extractPayment(event) {
  if (!event || typeof event !== 'object') return null;
  if (event.data && typeof event.data === 'object' && (event.data.id || event.data.amount !== undefined)) {
    return event.data;
  }
  // Some webhook payloads use the shape { ..., id: <payment id>, status: ... }
  if (event.id && (event.status !== undefined || event.amount !== undefined)) {
    return event;
  }
  return null;
}

/**
 * Find an order document by its Rapyd paymentId field.
 *
 * @param {string} rapydPaymentId
 * @returns {Promise<FirebaseFirestore.QueryDocumentSnapshot|null>}
 */
async function findOrderByRapydPaymentId(rapydPaymentId) {
  const snap = await Order.collection()
    .where('rapydPaymentId', '==', rapydPaymentId)
    .limit(1)
    .get();

  if (snap.empty) return null;
  return snap.docs[0];
}

/**
 * Update an order's status and record the Rapyd event id for audit.
 * Skips the write if the order is already in the desired status (idempotency).
 *
 * @param {FirebaseFirestore.DocumentSnapshot} orderDoc
 * @param {string} newStatus
 * @param {string} rapydEventId
 * @returns {Promise<boolean>} true if updated, false if skipped (already in status)
 */
async function updateOrderStatus(orderDoc, newStatus, rapydEventId) {
  const current = orderDoc.data();

  // Idempotency guard — do not overwrite a terminal status with the same value.
  if (current.status === newStatus) {
    logger.info(
      `Rapyd webhook idempotency: order ${orderDoc.id} already has status '${newStatus}'. ` +
      `Skipping update for event ${rapydEventId}.`
    );
    return false;
  }

  const update = {
    status: newStatus,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (rapydEventId) update.rapydEventId = rapydEventId;

  await orderDoc.ref.update(update);

  logger.info(
    `Order ${orderDoc.id} status updated: '${current.status}' → '${newStatus}' ` +
    `(rapyd event: ${rapydEventId || 'unknown'})`
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

    logger.info(`Cart cleared for user ${userId} after successful Rapyd payment.`);
  } catch (err) {
    // Cart clearing is best-effort — log but do not fail the webhook response.
    logger.error(`Failed to clear cart for user ${userId}: ${err.message}`);
  }
}

// ─── Event Handlers ──────────────────────────────────────────────────────────

/**
 * Handle a Rapyd payment-succeeded event.
 *
 * 1. Find the order associated with the Rapyd payment.
 * 2. Update order status to 'paid'.
 * 3. Clear the user's cart.
 *
 * @param {object} payment    Rapyd Payment object from event.data
 * @param {string} eventId    Rapyd event id (for audit)
 */
async function handlePaymentSucceeded(payment, eventId) {
  const paymentId = payment && payment.id;
  const userIdFromMetadata = payment && payment.metadata && payment.metadata.userId;

  logger.info(
    `Handling Rapyd payment.SUCCEEDED: ${paymentId} ` +
    `(userId: ${userIdFromMetadata || 'unknown'}, eventId: ${eventId})`
  );

  if (!paymentId) {
    logger.warn(`Rapyd succeeded event ${eventId} has no payment id; nothing to do.`);
    return;
  }

  const orderDoc = await findOrderByRapydPaymentId(paymentId);

  if (!orderDoc) {
    // The order may not exist yet if the frontend hasn't called POST /api/orders/create.
    // This is acceptable — the webhook is informational. Log and return.
    logger.warn(
      `Rapyd payment.SUCCEEDED: no order found for rapydPaymentId ${paymentId}. ` +
      `The order may be created shortly by the frontend.`
    );
    return;
  }

  await updateOrderStatus(orderDoc, 'paid', eventId);

  // Clear the user's cart — prefer the userId stored on the order itself,
  // fall back to the Rapyd payment metadata.
  const orderUserId = orderDoc.data().user || userIdFromMetadata;
  if (orderUserId) {
    await clearUserCart(orderUserId);
  } else {
    logger.warn(
      `Rapyd payment.SUCCEEDED: cannot clear cart — userId not found on order ${orderDoc.id} ` +
      `or in Rapyd payment metadata.`
    );
  }
}

/**
 * Handle a Rapyd payment-failed event.
 *
 * Updates the order status to 'payment_failed' so the merchant and customer
 * can be notified and the order can be retried or cancelled.
 *
 * @param {object} payment Rapyd Payment object from event.data
 * @param {string} eventId Rapyd event id (for audit)
 */
async function handlePaymentFailed(payment, eventId) {
  const paymentId = payment && payment.id;
  // Rapyd surfaces failure context across multiple fields depending on cause:
  //   - failure_code / failure_message   (card declines)
  //   - error_code / error_message       (validation errors)
  //   - status (e.g. 'REJ', 'EXP', 'CAN', 'ERR')
  const failureMessage =
    (payment && (payment.failure_message || payment.error_message)) ||
    (payment && payment.status ? `status=${payment.status}` : 'Unknown payment failure');

  logger.warn(
    `Handling Rapyd payment.FAILED: ${paymentId} (eventId: ${eventId}). ` +
    `Reason: ${failureMessage}`
  );

  if (!paymentId) {
    logger.warn(`Rapyd failed event ${eventId} has no payment id; nothing to do.`);
    return;
  }

  const orderDoc = await findOrderByRapydPaymentId(paymentId);

  if (!orderDoc) {
    logger.warn(
      `Rapyd payment.FAILED: no order found for rapydPaymentId ${paymentId}.`
    );
    return;
  }

  await updateOrderStatus(orderDoc, 'payment_failed', eventId);
}

// ─── Main Webhook Handler ────────────────────────────────────────────────────

/**
 * @route   POST /api/rapyd/webhook
 * @desc    Receive and process Rapyd webhook events.
 *          Must be mounted with express.raw({ type: 'application/json' })
 *          so that the raw body is available for signature verification.
 * @access  Public (Rapyd servers only — verified via HMAC signature)
 *
 * Response 200: { received: true }
 * Response 400: { error: string }  (invalid signature or malformed payload)
 * Response 500: { error: string }  (server error — Rapyd will retry)
 */
exports.handleWebhook = async (req, res) => {
  // ── 1. Validate configuration ──────────────────────────────────────────────
  if (!process.env.RAPYD_WEBHOOK_SECRET) {
    logger.error(
      'RAPYD_WEBHOOK_SECRET is not configured. ' +
      'Webhook events cannot be verified. Set this env variable.'
    );
    // Return 500 so Rapyd retries — this is a server misconfiguration.
    return res.status(500).json({
      error: 'Webhook secret not configured on server.',
    });
  }

  // ── 2. Verify Rapyd signature ──────────────────────────────────────────────
  let event;
  try {
    // req.body must be the raw Buffer (express.raw middleware).
    event = rapyd.webhooks.constructEvent(req.body, req.headers);
  } catch (err) {
    // AppError carries an HTTP status; misconfiguration → 500, anything else → 400.
    const httpStatus = err instanceof AppError && err.statusCode === 500 ? 500 : 400;
    if (httpStatus === 500) {
      logger.error(`Rapyd webhook configuration error: ${err.message}`);
    } else {
      logger.warn(`Rapyd webhook signature verification failed: ${err.message}`);
    }
    return res.status(httpStatus).json({
      error: `Webhook signature verification failed: ${err.message}`,
    });
  }

  const eventId = (event && (event.id || event.event_id)) || 'unknown';
  const eventType = (event && (event.type || event.event_type)) || 'unknown';
  logger.info(`Rapyd webhook received: ${eventType} (id: ${eventId})`);

  // ── 3. Dispatch event to handler ───────────────────────────────────────────
  const verdict = classifyEventType(eventType);
  const payment = extractPayment(event);

  try {
    switch (verdict) {
      case 'succeeded':
        if (!payment) {
          logger.warn(
            `Rapyd ${eventType} (id: ${eventId}) has no payment data; ignoring.`
          );
          break;
        }
        await handlePaymentSucceeded(payment, eventId);
        break;

      case 'failed':
        if (!payment) {
          logger.warn(
            `Rapyd ${eventType} (id: ${eventId}) has no payment data; ignoring.`
          );
          break;
        }
        await handlePaymentFailed(payment, eventId);
        break;

      default:
        // Log unhandled events at debug level — Rapyd sends many event types
        // (refunds, payouts, checkout pages, etc.) that we do not consume here.
        logger.debug(`Unhandled Rapyd event type: ${eventType} (id: ${eventId})`);
        break;
    }
  } catch (err) {
    // Log the error and return 500 so Rapyd retries this delivery according
    // to its retry policy. The handlers above are idempotent (status guard +
    // payment-id lookup) so retries are safe.
    logger.error(
      `Error processing Rapyd event ${eventType} (id: ${eventId}): ${err.message}`,
      { stack: err.stack }
    );
    return res.status(500).json({
      error: 'Internal server error while processing webhook event.',
    });
  }

  // ── 4. Acknowledge receipt ─────────────────────────────────────────────────
  // Rapyd requires a 2xx response promptly; otherwise the event is retried.
  res.status(200).json({ received: true });
};

// Internal exports for unit testing — not part of the public route surface.
exports._internal = {
  classifyEventType,
  extractPayment,
  findOrderByRapydPaymentId,
  updateOrderStatus,
  clearUserCart,
  handlePaymentSucceeded,
  handlePaymentFailed,
};
