/**
 * Stripe Webhook Controller
 *
 * Handles incoming Stripe webhook events. The raw request body is required
 * for signature verification — this controller must only be used with the
 * `express.raw({ type: 'application/json' })` middleware (NOT express.json()).
 *
 * Supported events:
 *   - payment_intent.succeeded      → mark order 'paid', clear user cart
 *   - payment_intent.payment_failed → mark order 'payment_failed'
 *
 * Security:
 *   - Stripe signature is verified via STRIPE_WEBHOOK_SECRET before any
 *     business logic runs. Requests with invalid signatures are rejected 400.
 *   - Idempotency: if the order is already in the target status the handler
 *     returns 200 immediately without writing to Firestore.
 */

'use strict';

const stripe = require('../services/stripe');
const { getDb, admin } = require('../services/db');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const logger = require('../utils/logger');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Find an order document by its Stripe paymentIntentId field.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} paymentIntentId
 * @returns {Promise<FirebaseFirestore.QueryDocumentSnapshot|null>}
 */
async function findOrderByPaymentIntent(db, paymentIntentId) {
  const snap = await Order.collection()
    .where('paymentIntentId', '==', paymentIntentId)
    .limit(1)
    .get();

  if (snap.empty) return null;
  return snap.docs[0];
}

/**
 * Update an order's status and record the Stripe event id for audit.
 * Skips the write if the order is already in the desired status (idempotency).
 *
 * @param {FirebaseFirestore.DocumentSnapshot} orderDoc
 * @param {string} newStatus
 * @param {string} stripeEventId
 * @returns {Promise<boolean>} true if updated, false if skipped (already in status)
 */
async function updateOrderStatus(orderDoc, newStatus, stripeEventId) {
  const current = orderDoc.data();

  // Idempotency guard — do not overwrite a terminal status with the same value
  if (current.status === newStatus) {
    logger.info(
      `Webhook idempotency: order ${orderDoc.id} already has status '${newStatus}'. ` +
      `Skipping update for event ${stripeEventId}.`
    );
    return false;
  }

  await orderDoc.ref.update({
    status: newStatus,
    stripeEventId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logger.info(
    `Order ${orderDoc.id} status updated: '${current.status}' → '${newStatus}' ` +
    `(event: ${stripeEventId})`
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

    logger.info(`Cart cleared for user ${userId} after successful payment.`);
  } catch (err) {
    // Cart clearing is best-effort — log but do not fail the webhook response
    logger.error(`Failed to clear cart for user ${userId}: ${err.message}`);
  }
}

// ─── Event Handlers ───────────────────────────────────────────────────────────

/**
 * Handle `payment_intent.succeeded`.
 *
 * 1. Find the order associated with the PaymentIntent.
 * 2. Update order status to 'paid'.
 * 3. Clear the user's cart.
 *
 * @param {import('stripe').Stripe.PaymentIntent} paymentIntent
 * @param {string} stripeEventId
 */
async function handlePaymentIntentSucceeded(paymentIntent, stripeEventId) {
  const { id: paymentIntentId, metadata } = paymentIntent;
  const userId = metadata && metadata.userId;

  logger.info(
    `Handling payment_intent.succeeded: ${paymentIntentId} ` +
    `(userId: ${userId || 'unknown'})`
  );

  const db = getDb();
  const orderDoc = await findOrderByPaymentIntent(db, paymentIntentId);

  if (!orderDoc) {
    // The order may not exist yet if the frontend hasn't called POST /api/orders/create.
    // This is acceptable — the webhook is informational. Log and return.
    logger.warn(
      `payment_intent.succeeded: no order found for paymentIntentId ${paymentIntentId}. ` +
      `The order may be created shortly by the frontend.`
    );
    return;
  }

  // Update order status
  await updateOrderStatus(orderDoc, 'paid', stripeEventId);

  // Clear the user's cart — use userId from order data as the authoritative source
  const orderUserId = orderDoc.data().user || userId;
  if (orderUserId) {
    await clearUserCart(orderUserId);
  } else {
    logger.warn(
      `payment_intent.succeeded: cannot clear cart — userId not found in order ${orderDoc.id} ` +
      `or PaymentIntent metadata.`
    );
  }
}

/**
 * Handle `payment_intent.payment_failed`.
 *
 * Updates the order status to 'payment_failed' so the merchant and customer
 * can be notified and the order can be retried or cancelled.
 *
 * @param {import('stripe').Stripe.PaymentIntent} paymentIntent
 * @param {string} stripeEventId
 */
async function handlePaymentIntentFailed(paymentIntent, stripeEventId) {
  const { id: paymentIntentId, last_payment_error } = paymentIntent;
  const failureMessage = last_payment_error
    ? last_payment_error.message
    : 'Unknown payment failure';

  logger.warn(
    `Handling payment_intent.payment_failed: ${paymentIntentId}. ` +
    `Reason: ${failureMessage}`
  );

  const db = getDb();
  const orderDoc = await findOrderByPaymentIntent(db, paymentIntentId);

  if (!orderDoc) {
    logger.warn(
      `payment_intent.payment_failed: no order found for paymentIntentId ${paymentIntentId}.`
    );
    return;
  }

  await updateOrderStatus(orderDoc, 'payment_failed', stripeEventId);
}

// ─── Main Webhook Handler ─────────────────────────────────────────────────────

/**
 * @route   POST /api/stripe/webhook
 * @desc    Receive and process Stripe webhook events.
 *          Must be mounted with express.raw({ type: 'application/json' })
 *          so that the raw body is available for signature verification.
 * @access  Public (Stripe servers only — verified via HMAC signature)
 *
 * Response 200: { received: true }
 * Response 400: { error: string }  (invalid signature or malformed payload)
 */
exports.handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // ── 1. Validate configuration ──────────────────────────────────────────────
  if (!webhookSecret) {
    logger.error(
      'STRIPE_WEBHOOK_SECRET is not configured. ' +
      'Webhook events cannot be verified. Set this env variable.'
    );
    // Return 500 so Stripe retries — this is a server misconfiguration
    return res.status(500).json({
      error: 'Webhook secret not configured on server.',
    });
  }

  if (!sig) {
    logger.warn('Webhook request received without stripe-signature header.');
    return res.status(400).json({
      error: 'Missing stripe-signature header.',
    });
  }

  // ── 2. Verify Stripe signature ─────────────────────────────────────────────
  let event;
  try {
    // req.body must be the raw Buffer (express.raw middleware)
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    logger.warn(`Stripe webhook signature verification failed: ${err.message}`);
    return res.status(400).json({
      error: `Webhook signature verification failed: ${err.message}`,
    });
  }

  logger.info(`Stripe webhook received: ${event.type} (id: ${event.id})`);

  // ── 3. Dispatch event to handler ───────────────────────────────────────────
  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object, event.id);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event.data.object, event.id);
        break;

      default:
        // Log unhandled events at debug level — Stripe sends many event types
        logger.debug(`Unhandled Stripe event type: ${event.type} (id: ${event.id})`);
        break;
    }
  } catch (err) {
    // Log the error but still return 200 to prevent Stripe from retrying
    // events that cause persistent server errors (e.g., Firestore unavailable).
    // For transient errors, Stripe's retry logic will re-deliver the event.
    logger.error(
      `Error processing Stripe event ${event.type} (id: ${event.id}): ${err.message}`,
      { stack: err.stack }
    );
    // Return 500 to signal Stripe to retry this event
    return res.status(500).json({
      error: 'Internal server error while processing webhook event.',
    });
  }

  // ── 4. Acknowledge receipt ─────────────────────────────────────────────────
  // Stripe requires a 2xx response within 30 seconds to consider delivery successful.
  res.status(200).json({ received: true });
};
