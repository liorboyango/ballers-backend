/**
 * Order Controller
 *
 * Handles order creation, retrieval, and Airwallex payment creation.
 *
 * createOrder runs in a Firestore transaction so that stock validation,
 * order creation, and cart clearing are atomic.
 *
 * The order creation flow (Airwallex-integrated):
 *   1. Frontend calls POST /api/orders/create-payment-intent → gets clientSecret
 *      + paymentIntentId.
 *   2. Frontend confirms payment via Airwallex.js using the clientSecret.
 *   3. On Airwallex success, frontend calls POST /api/orders/create with
 *      { airwallexPaymentIntentId, shippingAddress } to persist the order.
 *   4. Backend retrieves the Airwallex Payment Intent, verifies status / userId /
 *      amount, then creates the order with status 'paid' (succeeded) or 'pending'
 *      (awaiting webhook).
 *   5. Airwallex webhook (payment_intent.succeeded) updates status to 'paid' and
 *      clears the cart if the order was created before the webhook fired.
 *
 * createPaymentIntent (Airwallex):
 *   1. Fetches the authenticated user's cart from Firestore.
 *   2. Validates cart items and checks product stock.
 *   3. Calculates the order total (subtotal + shipping).
 *   4. Creates an Airwallex Payment Intent and returns the clientSecret needed
 *      by Airwallex.js to render the secure card element and confirm the payment.
 */
const { admin, getDb } = require('../services/db');
const airwallex = require('../services/airwallex');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

// ─── Helpers ───────────────────────────────────────────────

/**
 * Calculate order totals from an array of cart items enriched with product data.
 * @param {Array<{price: number, quantity: number}>} orderItems
 * @returns {{ subtotal: number, shippingCost: number, total: number }}
 */
const calculateTotals = (orderItems) => {
  const subtotal = Math.round(
    orderItems.reduce((sum, it) => sum + it.price * it.quantity, 0) * 100
  ) / 100;
  const shippingCost = subtotal >= 100 ? 0 : 9.99;
  const total = Math.round((subtotal + shippingCost) * 100) / 100;
  return { subtotal, shippingCost, total };
};

/**
 * Extract the client secret from an Airwallex Payment Intent response.
 *
 * Airwallex returns a `client_secret` on the created Payment Intent which the
 * frontend passes to Airwallex.js to render the secure card element and
 * confirm the payment. We fall back to null if absent so the caller can decide
 * how to surface the error.
 *
 * @param {object} intent Airwallex Payment Intent data
 * @returns {string|null}
 */
const extractClientSecret = (intent) => {
  if (!intent || typeof intent !== 'object') return null;
  return intent.client_secret || null;
};

// ───── Airwallex payment intent status helpers ────────────────────────────
//
// Airwallex Payment Intents move through these documented statuses:
//   'REQUIRES_PAYMENT_METHOD' — created, no payment method attached yet
//   'REQUIRES_CUSTOMER_ACTION' — awaiting customer action (e.g. 3DS)
//   'REQUIRES_CAPTURE'         — authorised, awaiting capture
//   'SUCCEEDED'                — payment captured / completed
//   'CANCELLED'                — cancelled
//   'EXPIRED'                  — expired before completion
// 'PENDING' may also appear transiently and is treated as pending.

const AIRWALLEX_TERMINAL_FAILED = new Set(['CANCELLED', 'CANCELED', 'EXPIRED', 'FAILED']);
const AIRWALLEX_SUCCESS = new Set(['SUCCEEDED']);
const AIRWALLEX_PENDING = new Set([
  'REQUIRES_PAYMENT_METHOD',
  'REQUIRES_CUSTOMER_ACTION',
  'REQUIRES_CAPTURE',
  'PENDING',
]);

/**
 * Normalise an Airwallex status to one of: 'success' | 'pending' | 'failed' | 'unknown'.
 * @param {string|undefined|null} status
 * @returns {'success'|'pending'|'failed'|'unknown'}
 */
const classifyAirwallexStatus = (status) => {
  if (!status) return 'unknown';
  const s = String(status).toUpperCase();
  if (AIRWALLEX_SUCCESS.has(s)) return 'success';
  if (AIRWALLEX_TERMINAL_FAILED.has(s)) return 'failed';
  if (AIRWALLEX_PENDING.has(s)) return 'pending';
  return 'unknown';
};

/**
 * Verify an Airwallex Payment Intent and return its data.
 *
 * Validates that:
 *   - The Payment Intent exists.
 *   - It belongs to the authenticated user (via metadata.userId).
 *   - Its status is acceptable for order creation: success ('SUCCEEDED') or
 *     pending ('REQUIRES_*'). Terminal failure statuses ('CANCELLED', 'EXPIRED')
 *     are rejected.
 *
 * Amount/currency are also returned so the controller can perform an
 * exact-match check against the cart-derived total before persisting the order.
 *
 * @param {string} paymentIntentId Airwallex payment intent id (e.g. 'int_xxx')
 * @param {string} userId Authenticated user id
 * @returns {Promise<object>} The Airwallex Payment Intent data
 * @throws {AppError} on invalid/mismatched/failed Payment Intent
 */
const verifyAirwallexPaymentIntent = async (paymentIntentId, userId) => {
  let intent;
  try {
    intent = await airwallex.retrievePaymentIntent(paymentIntentId);
  } catch (err) {
    logger.warn(
      `Failed to retrieve Airwallex payment intent ${paymentIntentId} for user ${userId}: ${err.message}`
    );
    throw new AppError(
      'Payment verification failed. The payment reference is invalid or could not be found.',
      400
    );
  }

  if (!intent || typeof intent !== 'object' || !intent.id) {
    logger.warn(
      `Airwallex payment intent ${paymentIntentId} returned an empty/invalid envelope for user ${userId}`
    );
    throw new AppError(
      'Payment verification failed. Airwallex returned an invalid response.',
      400
    );
  }

  // Guard: ensure the Payment Intent belongs to this user (via metadata)
  if (intent.metadata && intent.metadata.userId) {
    if (intent.metadata.userId !== userId) {
      logger.warn(
        `Airwallex payment intent ${paymentIntentId} userId mismatch: ` +
        `expected ${userId}, got ${intent.metadata.userId}`
      );
      throw new AppError(
        'Payment verification failed. This payment does not belong to your account.',
        403
      );
    }
  }

  // Guard: reject terminal failure / cancellation statuses
  const verdict = classifyAirwallexStatus(intent.status);
  if (verdict === 'failed') {
    logger.warn(
      `Airwallex payment intent ${paymentIntentId} has terminal status '${intent.status}' ` +
      `for order creation (user: ${userId})`
    );
    throw new AppError(
      `Cannot create an order for a payment with status '${intent.status}'. ` +
      'Please complete the payment process before placing your order.',
      400
    );
  }

  return intent;
};

// ─── Controllers ─────────────────────────────────────

/**
 * @route   POST /api/orders/create-payment-intent
 * @desc    Fetch cart items, calculate the total, create an Airwallex Payment
 *          Intent, and return the clientSecret needed by Airwallex.js to render
 *          the secure card element and confirm the payment.
 * @access  Protected (JWT)
 *
 * Response 200:
 * {
 *   status: 'success',
 *   data: {
 *     paymentIntentId: string,    // Airwallex payment intent id (e.g. 'int_xxx')
 *     clientSecret: string|null,  // Secret Airwallex.js uses to render the card
 *                                 // element & confirm the payment.
 *     amount: number,             // Total in minor units (cents) for parity
 *                                 // with the rest of the system's amount math.
 *     currency: string,           // 'USD'
 *     orderSummary: {
 *       items: Array,
 *       subtotal: number,
 *       shippingCost: number,
 *       total: number,
 *       itemCount: number,
 *     }
 *   }
 * }
 */
exports.createPaymentIntent = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;

  // ── 1. Fetch cart ────────────────────────────────────────────
  const cartSnap = await Cart.docForUser(userId).get();

  if (!cartSnap.exists || !(cartSnap.data().items || []).length) {
    return next(
      new AppError('Your cart is empty. Add items before proceeding to checkout.', 400)
    );
  }

  const cartItems = cartSnap.data().items;

  // ── 2. Fetch product data and validate stock ───────────────────────────
  const productRefs = cartItems.map((it) => Product.collection().doc(it.product));
  const productSnaps = await getDb().getAll(...productRefs);

  const productById = new Map();
  for (const snap of productSnaps) {
    if (snap.exists) productById.set(snap.id, snap.data());
  }

  const stockErrors = [];
  const orderItems = [];

  for (const item of cartItems) {
    const product = productById.get(item.product);

    if (!product) {
      stockErrors.push({
        field: 'cart',
        message: 'One or more products in your cart no longer exist.',
      });
      continue;
    }

    if (product.stock !== undefined && product.stock < item.quantity) {
      stockErrors.push({
        field: product.name,
        message: `Only ${product.stock} unit(s) available for "${product.name}".`,
      });
      continue;
    }

    orderItems.push({
      product: item.product,
      name: product.name,
      price: product.price,
      quantity: item.quantity,
      customization: item.customization || null,
    });
  }

  if (stockErrors.length > 0) {
    return next(
      new AppError('Some items in your cart are out of stock or unavailable.', 400, stockErrors)
    );
  }

  // ── 3. Calculate totals ─────────────────────────────────────────
  const { subtotal, shippingCost, total } = calculateTotals(orderItems);

  // Amount is computed in MINOR units (cents) so the response shape stays
  // consistent with the rest of the system. The Airwallex service converts
  // back to major units internally before sending the request.
  const amountInCents = Math.round(total * 100);

  // ── 4. Create Airwallex Payment Intent ──────────────────────────
  let intent;
  try {
    intent = await airwallex.createPaymentIntent({
      amount: amountInCents,
      currency: 'USD',
      description: `Ballers order — ${orderItems.length} item(s)`,
      metadata: {
        userId,
        itemCount: String(orderItems.length),
        subtotal: String(subtotal),
        shippingCost: String(shippingCost),
        amountCents: String(amountInCents),
      },
    });
  } catch (airwallexError) {
    logger.error(
      `Airwallex payment intent creation failed for user ${userId}: ${airwallexError.message}`
    );
    // Bubble AppErrors (already user-safe) verbatim; wrap anything else as 502.
    if (airwallexError instanceof AppError) return next(airwallexError);
    return next(
      new AppError(
        'Unable to initialise payment. Please try again or contact support.',
        502
      )
    );
  }

  if (!intent || !intent.id) {
    logger.error(
      `Airwallex payment intent creation returned an invalid response for user ${userId}`
    );
    return next(
      new AppError('Unable to initialise payment — invalid Airwallex response.', 502)
    );
  }

  const clientSecret = extractClientSecret(intent);

  logger.info(
    `Airwallex payment intent created: ${intent.id} for user ${userId}, ` +
    `amount: $${total} (${amountInCents} cents), status: ${intent.status || 'unknown'}`
  );

  // ── 5. Return Airwallex payment intent details to the frontend ────────────
  res.status(200).json({
    status: 'success',
    data: {
      paymentIntentId: intent.id,
      clientSecret,
      amount: amountInCents,
      currency: (intent.currency || 'USD').toUpperCase(),
      orderSummary: {
        items: orderItems,
        subtotal,
        shippingCost,
        total,
        itemCount: orderItems.length,
      },
    },
  });
});

/**
 * Map a Hosted-Checkout shipping address (which uses `zip`) to the stored
 * order shape (which uses `postalCode`), dropping the redundant `zip` key.
 * @param {object} addr
 * @returns {object}
 */
const normalizeShippingAddress = (addr) => {
  if (!addr || typeof addr !== 'object') return addr;
  const { zip, ...rest } = addr;
  return { ...rest, postalCode: zip };
};

/**
 * Resolve the frontend base URL used to build Airwallex redirect targets.
 * @returns {string}
 */
const getFrontendUrl = () =>
  (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');

/**
 * @route   POST /api/orders/create-checkout-session
 * @desc    Hosted Checkout (redirect flow) entrypoint. Reads the user's cart,
 *          validates stock, creates an Airwallex Payment Intent, pre-creates a
 *          PENDING order keyed by the intent id (so the webhook can later
 *          promote it to 'paid' even if the user never returns), and returns a
 *          redirect URL to Airwallex's Hosted Payment Page.
 *
 *          The cart is NOT cleared here — a user who abandons the hosted page
 *          should still see their cart. It is cleared on successful finalize or
 *          by the webhook.
 *
 * @access  Protected (JWT)
 *
 * Request body: { shippingAddress: { ..., zip }, notes? }
 *
 * Response 200:
 * { status: 'success', data: { checkoutId, redirectUrl } }
 */
exports.createCheckoutSession = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { shippingAddress, notes } = req.body;
  const db = getDb();

  // ── 1. Fetch cart ────────────────────────────────────────────
  const cartSnap = await Cart.docForUser(userId).get();
  if (!cartSnap.exists || !(cartSnap.data().items || []).length) {
    return next(
      new AppError('Your cart is empty. Add items before proceeding to checkout.', 400)
    );
  }
  const cartItems = cartSnap.data().items;

  // ── 2. Fetch product data and validate stock ───────────────────────────
  const productRefs = cartItems.map((it) => Product.collection().doc(it.product));
  const productSnaps = await db.getAll(...productRefs);
  const productById = new Map();
  for (const snap of productSnaps) {
    if (snap.exists) productById.set(snap.id, snap.data());
  }

  const stockErrors = [];
  const orderItems = [];
  for (const item of cartItems) {
    const product = productById.get(item.product);
    if (!product) {
      stockErrors.push({
        field: 'cart',
        message: 'One or more products in your cart no longer exist.',
      });
      continue;
    }
    if (product.stock !== undefined && product.stock < item.quantity) {
      stockErrors.push({
        field: product.name,
        message: `Only ${product.stock} unit(s) available for "${product.name}".`,
      });
      continue;
    }
    orderItems.push({
      product: item.product,
      name: product.name,
      price: product.price,
      quantity: item.quantity,
      customization: item.customization || null,
    });
  }
  if (stockErrors.length > 0) {
    return next(
      new AppError('Some items in your cart are out of stock or unavailable.', 400, stockErrors)
    );
  }

  // ── 3. Calculate totals ─────────────────────────────────────────
  const { subtotal, shippingCost, total } = calculateTotals(orderItems);
  const amountInCents = Math.round(total * 100);

  // ── 4. Create Airwallex Payment Intent ──────────────────────────
  const frontendUrl = getFrontendUrl();

  let intent;
  try {
    intent = await airwallex.createPaymentIntent({
      amount: amountInCents,
      currency: 'USD',
      description: `Ballers order — ${orderItems.length} item(s)`,
      metadata: {
        userId,
        itemCount: String(orderItems.length),
        subtotal: String(subtotal),
        shippingCost: String(shippingCost),
        amountCents: String(amountInCents),
      },
    });
  } catch (airwallexError) {
    logger.error(
      `Airwallex checkout session creation failed for user ${userId}: ${airwallexError.message}`
    );
    if (airwallexError instanceof AppError) return next(airwallexError);
    return next(
      new AppError('Unable to initialise checkout. Please try again or contact support.', 502)
    );
  }

  if (!intent || !intent.id) {
    logger.error(
      `Airwallex checkout session returned an invalid response for user ${userId}`
    );
    return next(new AppError('Unable to initialise checkout — invalid Airwallex response.', 502));
  }

  const clientSecret = extractClientSecret(intent);
  if (!clientSecret) {
    logger.error(
      `Airwallex checkout session ${intent.id} missing client_secret for user ${userId}`
    );
    return next(new AppError('Unable to initialise checkout — missing payment secret.', 502));
  }

  // ── 5. Pre-create a PENDING order keyed by the intent id ────────────────
  // The webhook handler updates orders by airwallexPaymentIntentId; it never
  // creates them. Persisting a pending order now guarantees the payment can be
  // reconciled to 'paid' even if the user closes the tab before returning.
  // The cart is intentionally left intact.
  const now = admin.firestore.FieldValue.serverTimestamp();
  const orderRef = Order.collection().doc();
  await orderRef.set({
    user: userId,
    orderNumber: Order.generateOrderNumber(),
    items: orderItems,
    shippingAddress: normalizeShippingAddress(shippingAddress),
    paymentMethod: 'airwallex',
    airwallexPaymentIntentId: intent.id,
    notes: notes || '',
    subtotal: Math.round(subtotal * 100) / 100,
    shippingCost,
    total,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  });

  // ── 6. Build the hosted checkout redirect URL ───────────────────────────
  const completeUrl = `${frontendUrl}/checkout/complete?checkoutId=${encodeURIComponent(intent.id)}`;
  const redirectUrl = airwallex.buildHostedCheckoutUrl({
    intentId: intent.id,
    clientSecret,
    currency: (intent.currency || 'USD').toUpperCase(),
    amount: Number((amountInCents / 100).toFixed(2)),
    successUrl: completeUrl,
    failUrl: `${completeUrl}&status=failed`,
    cancelUrl: `${frontendUrl}/cart`,
  });

  logger.info(
    `Checkout session created: intent ${intent.id} (pending order ${orderRef.id}) ` +
    `for user ${userId}, amount: $${total} (${amountInCents} cents)`
  );

  res.status(200).json({
    status: 'success',
    data: {
      checkoutId: intent.id,
      redirectUrl,
    },
  });
});

/**
 * @route   POST /api/orders/finalize-checkout
 * @desc    Called when the user returns from Airwallex's Hosted Payment Page.
 *          Re-fetches the Payment Intent, verifies ownership, locates the
 *          pending order pre-created at session start, and promotes it to
 *          'paid' (clearing the cart) on success or 'payment_failed' on a
 *          terminal failure. Idempotent — safe to call repeatedly.
 *
 * @access  Protected (JWT)
 *
 * Request body: { checkoutId } (the Airwallex payment intent id, int_...)
 *
 * Response 200: { status: 'success', data: <Order> }
 */
exports.finalizeCheckout = asyncHandler(async (req, res, next) => {
  const userId = req.user.id;
  const { checkoutId } = req.body;
  const db = getDb();

  // ── 1. Verify the Payment Intent (existence, ownership, not failed-throwing) ─
  let intent;
  try {
    intent = await airwallex.retrievePaymentIntent(checkoutId);
  } catch (err) {
    logger.warn(`finalizeCheckout: failed to retrieve intent ${checkoutId} for user ${userId}: ${err.message}`);
    return next(new AppError('Payment verification failed. The checkout reference is invalid.', 400));
  }

  if (!intent || !intent.id) {
    return next(new AppError('Payment verification failed. Airwallex returned an invalid response.', 400));
  }

  if (intent.metadata && intent.metadata.userId && intent.metadata.userId !== userId) {
    logger.warn(
      `finalizeCheckout: intent ${checkoutId} userId mismatch (expected ${userId}, got ${intent.metadata.userId})`
    );
    return next(new AppError('This checkout does not belong to your account.', 403));
  }

  // ── 2. Locate the pending order pre-created at session start ─────────────
  const orderSnap = await Order.collection()
    .where('airwallexPaymentIntentId', '==', checkoutId)
    .limit(1)
    .get();

  if (orderSnap.empty) {
    logger.warn(`finalizeCheckout: no order found for intent ${checkoutId} (user ${userId})`);
    return next(new AppError('No order was found for this checkout.', 404));
  }

  const orderRef = orderSnap.docs[0].ref;
  let order = Order.serialize(orderSnap.docs[0]);

  if (order.user !== userId) {
    return next(new AppError('No order was found for this checkout.', 404));
  }

  const verdict = classifyAirwallexStatus(intent.status);
  const now = admin.firestore.FieldValue.serverTimestamp();

  // ── 3. Promote the order based on the verified payment status ────────────
  // Idempotent: only transition out of 'pending'. Orders already 'paid'
  // (e.g. promoted by the webhook) are returned as-is.
  if (order.status === 'pending') {
    if (verdict === 'success') {
      await db.runTransaction(async (tx) => {
        tx.update(orderRef, { status: 'paid', updatedAt: now });
        tx.update(Cart.docForUser(userId), { items: [], updatedAt: now });
      });
      logger.info(`finalizeCheckout: order ${order.id} marked paid (intent ${checkoutId}, user ${userId})`);
    } else if (verdict === 'failed') {
      await orderRef.update({ status: 'payment_failed', updatedAt: now });
      logger.info(
        `finalizeCheckout: order ${order.id} marked payment_failed ` +
        `(intent status ${intent.status}, user ${userId})`
      );
    } else {
      logger.info(
        `finalizeCheckout: order ${order.id} still pending ` +
        `(intent status ${intent.status}, user ${userId})`
      );
    }
    order = Order.serialize(await orderRef.get());
  }

  res.status(200).json({
    status: 'success',
    data: order,
  });
});

// ─── Existing Controllers ───────────────────────────────────────

/**
 * @route   POST /api/orders/create
 * @desc    Create a new order from the user's cart, associated with a verified
 *          Airwallex Payment Intent.
 *
 *          Flow:
 *          1. Validate the Payment Intent (must exist, belong to user, not failed/cancelled).
 *          2. Check for duplicate orders (idempotency — same airwallexPaymentIntentId).
 *          3. Run a Firestore transaction to:
 *             a. Validate cart is non-empty.
 *             b. Validate product stock.
 *             c. Validate the Airwallex payment amount matches the cart total.
 *             d. Create the order document with airwallexPaymentIntentId.
 *             e. Clear the user's cart.
 *          4. Return the created order.
 *
 *          The initial order status is set to:
 *          - 'paid'    — if the Payment Intent status is success ('SUCCEEDED');
 *                        the payment is already captured.
 *          - 'pending' — otherwise (the webhook will update to 'paid' when
 *                        Airwallex emits payment_intent.succeeded).
 *
 * @access  Protected (JWT)
 *
 * Request body:
 * {
 *   airwallexPaymentIntentId: string,    // Airwallex payment intent id (int_...)
 *   shippingAddress: {
 *     firstName, lastName, email, address, city, postalCode, country, phone?
 *   },
 *   notes?: string
 * }
 *
 * Response 201:
 * {
 *   status: 'success',
 *   message: 'Order placed successfully.',
 *   data: {
 *     orderId: string,
 *     orderNumber: string,
 *     status: 'pending' | 'paid',
 *     airwallexPaymentIntentId: string,
 *     paymentMethod: 'airwallex',
 *     items: Array,
 *     subtotal: number,
 *     shippingCost: number,
 *     total: number,
 *     shippingAddress: object,
 *     createdAt: Timestamp
 *   }
 * }
 */
exports.createOrder = asyncHandler(async (req, res, next) => {
  const { shippingAddress, airwallexPaymentIntentId, notes } = req.body;
  const userId = req.user.id;
  const db = getDb();

  // ── 1. Verify the Airwallex Payment Intent ─────────────────────────
  let intent;
  try {
    intent = await verifyAirwallexPaymentIntent(airwallexPaymentIntentId, userId);
  } catch (err) {
    return next(err);
  }

  logger.info(
    `Order creation: Airwallex payment intent ${airwallexPaymentIntentId} verified for user ${userId} ` +
    `(status: ${intent.status})`
  );

  // ── 2. Idempotency check — prevent duplicate orders ────────────────────────
  // If an order already exists for this payment intent, return it instead of
  // creating a duplicate. This handles frontend retries gracefully.
  const existingOrderSnap = await Order.collection()
    .where('airwallexPaymentIntentId', '==', airwallexPaymentIntentId)
    .limit(1)
    .get();

  if (!existingOrderSnap.empty) {
    const existingOrder = Order.serialize(existingOrderSnap.docs[0]);
    logger.info(
      `Idempotency: order ${existingOrder.id} already exists for ` +
      `Airwallex payment intent ${airwallexPaymentIntentId}. Returning existing order.`
    );
    return res.status(200).json({
      status: 'success',
      message: 'Order already exists for this payment.',
      data: {
        orderId: existingOrder.id,
        orderNumber: existingOrder.orderNumber,
        status: existingOrder.status,
        airwallexPaymentIntentId: existingOrder.airwallexPaymentIntentId,
        paymentMethod: existingOrder.paymentMethod,
        items: existingOrder.items,
        subtotal: existingOrder.subtotal,
        shippingCost: existingOrder.shippingCost,
        total: existingOrder.total,
        shippingAddress: existingOrder.shippingAddress,
        createdAt: existingOrder.createdAt,
      },
    });
  }

  // ── 3. Determine initial order status from the Payment Intent ──────────────
  // If Airwallex has already settled the payment (status 'SUCCEEDED') we mark
  // the order 'paid' immediately. Otherwise we mark 'pending' and let the
  // webhook update it once Airwallex sends payment_intent.succeeded.
  const verdict = classifyAirwallexStatus(intent.status);
  const initialStatus = verdict === 'success' ? 'paid' : 'pending';

  // ── 4. Firestore transaction: validate cart, create order, clear cart ──────
  const cartRef = Cart.docForUser(userId);
  const orderRef = Order.collection().doc();

  const result = await db.runTransaction(async (tx) => {
    const cartSnap = await tx.get(cartRef);
    if (!cartSnap.exists || !(cartSnap.data().items || []).length) {
      throw new AppError('Your cart is empty. Add items before placing an order.', 400);
    }
    const cartItems = cartSnap.data().items;

    const productRefs = cartItems.map((it) => Product.collection().doc(it.product));
    const productSnaps = await tx.getAll(...productRefs);
    const productById = new Map();
    for (const s of productSnaps) {
      if (s.exists) productById.set(s.id, s.data());
    }

    const stockErrors = [];
    for (const item of cartItems) {
      const product = productById.get(item.product);
      if (!product) {
        stockErrors.push({
          field: 'cart',
          message: 'One or more products in your cart no longer exist.',
        });
        continue;
      }
      if (product.stock !== undefined && product.stock < item.quantity) {
        stockErrors.push({
          field: product.name,
          message: `Only ${product.stock} unit(s) available for "${product.name}".`,
        });
      }
    }
    if (stockErrors.length > 0) {
      throw new AppError('Some items in your cart are out of stock.', 400, stockErrors);
    }

    const orderItems = cartItems.map((item) => {
      const product = productById.get(item.product);
      return {
        product: item.product,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        customization: item.customization || null,
      };
    });

    const subtotal = orderItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
    const shippingCost = subtotal >= 100 ? 0 : 9.99;
    const total = Math.round((subtotal + shippingCost) * 100) / 100;

    // ── 4b. Amount exact-match check ──────────────────────────────────
    // Compare in minor units (cents) to avoid floating-point drift.
    // Airwallex returns `amount` in MAJOR units (e.g. 19.99) so multiply by 100.
    const expectedCents = Math.round(total * 100);
    const airwallexAmount = Number(intent.amount);
    if (Number.isFinite(airwallexAmount)) {
      const paymentCents = Math.round(airwallexAmount * 100);
      if (paymentCents !== expectedCents) {
        logger.warn(
          `Airwallex payment intent ${airwallexPaymentIntentId} amount mismatch for user ${userId}: ` +
          `payment=${paymentCents} cents, cart=${expectedCents} cents`
        );
        throw new AppError(
          'Payment amount does not match the cart total. Please refresh your cart and try again.',
          400
        );
      }
    }

    const now = admin.firestore.FieldValue.serverTimestamp();

    const orderData = {
      user: userId,
      orderNumber: Order.generateOrderNumber(),
      items: orderItems,
      shippingAddress,
      // paymentMethod is always 'airwallex' for Airwallex-integrated orders
      paymentMethod: 'airwallex',
      airwallexPaymentIntentId,
      notes: notes || '',
      subtotal: Math.round(subtotal * 100) / 100,
      shippingCost,
      total,
      status: initialStatus,
      createdAt: now,
      updatedAt: now,
    };

    tx.set(orderRef, orderData);

    // Clear the cart immediately for snappier UX. The webhook handler is
    // idempotent and tolerates an already-empty cart.
    tx.update(cartRef, { items: [], updatedAt: now });

    return orderData;
  });

  const orderSnap = await orderRef.get();
  const order = Order.serialize(orderSnap);

  logger.info(
    `Order created: ${order.id} (${order.orderNumber}) for user ${userId}, ` +
    `total: $${result.total}, status: ${result.status}, ` +
    `airwallexPaymentIntentId: ${airwallexPaymentIntentId}`
  );

  res.status(201).json({
    status: 'success',
    message: 'Order placed successfully.',
    data: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      airwallexPaymentIntentId: order.airwallexPaymentIntentId,
      paymentMethod: order.paymentMethod,
      items: order.items,
      subtotal: order.subtotal,
      shippingCost: order.shippingCost,
      total: order.total,
      shippingAddress: order.shippingAddress,
      createdAt: order.createdAt,
    },
  });
});

exports.getOrders = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 10, status, sort } = req.query;

  let query = Order.collection().where('user', '==', req.user.id);
  if (status) query = query.where('status', '==', status);

  let sortField = 'createdAt';
  let sortDir = 'desc';
  if (sort) {
    sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    sortDir = sort.startsWith('-') ? 'desc' : 'asc';
  }
  query = query.orderBy(sortField, sortDir);

  const docs = (await query.get()).docs.map(Order.serialize);
  const total = docs.length;
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;
  const orders = docs.slice(skip, skip + limitNum);

  res.status(200).json({
    status: 'success',
    results: orders.length,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      hasNextPage: pageNum < Math.ceil(total / limitNum),
      hasPrevPage: pageNum > 1,
    },
    data: orders,
  });
});

exports.getOrderById = asyncHandler(async (req, res, next) => {
  const snap = await Order.collection().doc(req.params.id).get();
  if (!snap.exists || snap.data().user !== req.user.id) {
    return next(new AppError('Order not found.', 404));
  }
  res.status(200).json({
    status: 'success',
    data: Order.serialize(snap),
  });
});
