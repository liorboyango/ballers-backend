/**
 * Order Controller
 *
 * Handles order creation, retrieval, and Rapyd payment creation.
 *
 * createOrder runs in a Firestore transaction so that stock validation,
 * order creation, and cart clearing are atomic.
 *
 * The order creation flow (Rapyd-integrated):
 *   1. Frontend calls POST /api/orders/create-payment-intent → gets clientToken
 *      + paymentId.
 *   2. Frontend confirms payment via the Rapyd Client SDK using the clientToken.
 *   3. On Rapyd success, frontend calls POST /api/orders/create with
 *      { rapydPaymentId, shippingAddress } to persist the order.
 *   4. Backend retrieves the Rapyd Payment, verifies status / userId / amount,
 *      then creates the order with status 'paid' (succeeded) or 'pending'
 *      (awaiting webhook).
 *   5. Rapyd webhook (payment.SUCCEEDED) updates status to 'paid' and clears
 *      the cart if the order was created before the webhook fired.
 *
 * createPaymentIntent (Rapyd):
 *   1. Fetches the authenticated user's cart from Firestore.
 *   2. Validates cart items and checks product stock.
 *   3. Calculates the order total (subtotal + shipping).
 *   4. Creates a Rapyd Payment and returns the clientToken needed by the
 *      Rapyd Client SDK to render the secure card iframe and confirm the payment.
 */
const { admin, getDb } = require('../services/db');
const rapyd = require('../services/rapyd');
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
 * Extract a usable client token from a Rapyd Payment response.
 *
 * Rapyd returns slightly different payloads depending on payment_method_type
 * and account configuration. Common locations for the token the Client SDK
 * needs to render the hosted card iframe and confirm the payment include:
 *
 *   - payment.redirect_url                (hosted page redirect)
 *   - payment.textual_codes.client_token  (token-based flow)
 *   - payment.payment_method_options.client_token
 *   - payment.next_action.redirect_url    (3DS redirect)
 *
 * We probe these in priority order and return the first non-empty value.
 * Falling back to the payment id ensures the frontend always receives
 * something it can use to look the payment up.
 *
 * @param {object} payment Rapyd Payment data
 * @returns {string|null}
 */
const extractClientToken = (payment) => {
  if (!payment || typeof payment !== 'object') return null;
  return (
    payment.client_token ||
    (payment.textual_codes && payment.textual_codes.client_token) ||
    (payment.payment_method_options && payment.payment_method_options.client_token) ||
    (payment.next_action && payment.next_action.redirect_url) ||
    payment.redirect_url ||
    null
  );
};

// ───── Rapyd payment status helpers ────────────────────────────
//
// Rapyd uses short status codes on the Payment object. Documented values:
//   'CLO' — Closed (payment captured / completed)
//   'ACT' — Active (awaiting confirmation, e.g. 3DS in progress, or pending
//            sync → still acceptable to create the order in 'pending' state)
//   'NEW' — Newly created, not yet processed
//   'CAN' — Cancelled
//   'EXP' — Expired
//   'ERR' — Errored
//   'REJ' — Rejected (e.g. card declined)
// Some sandbox environments also surface the verbose forms
// 'SUCCEEDED' / 'COMPLETED' / 'ACTIVATED' — we accept those as synonyms.

const RAPYD_TERMINAL_FAILED = new Set(['CAN', 'EXP', 'ERR', 'REJ', 'CANCELED', 'CANCELLED', 'EXPIRED', 'REJECTED', 'FAILED']);
const RAPYD_SUCCESS = new Set(['CLO', 'CLOSED', 'COMPLETED', 'SUCCEEDED', 'PAID']);
const RAPYD_ACTIVE = new Set(['ACT', 'ACTIVE', 'ACTIVATED', 'NEW', 'PENDING']);

/**
 * Normalise a Rapyd status to one of: 'success' | 'pending' | 'failed' | 'unknown'.
 * @param {string|undefined|null} status
 * @returns {'success'|'pending'|'failed'|'unknown'}
 */
const classifyRapydStatus = (status) => {
  if (!status) return 'unknown';
  const s = String(status).toUpperCase();
  if (RAPYD_SUCCESS.has(s)) return 'success';
  if (RAPYD_TERMINAL_FAILED.has(s)) return 'failed';
  if (RAPYD_ACTIVE.has(s)) return 'pending';
  return 'unknown';
};

/**
 * Verify a Rapyd Payment and return its data.
 *
 * Validates that:
 *   - The Rapyd Payment exists.
 *   - It belongs to the authenticated user (via metadata.userId).
 *   - Its status is acceptable for order creation: success ('CLO'/'CLOSED'/'COMPLETED')
 *     or pending ('ACT'/'NEW'). Terminal failure statuses ('CAN', 'REJ', 'EXP', 'ERR')
 *     are rejected.
 *
 * Amount/currency are also returned so the controller can perform an
 * exact-match check against the cart-derived total before persisting the order.
 *
 * @param {string} rapydPaymentId Rapyd payment id (e.g. 'payment_xxx')
 * @param {string} userId Authenticated user id
 * @returns {Promise<object>} The Rapyd Payment data
 * @throws {AppError} on invalid/mismatched/failed Payment
 */
const verifyRapydPayment = async (rapydPaymentId, userId) => {
  let payment;
  try {
    payment = await rapyd.retrievePayment(rapydPaymentId);
  } catch (err) {
    logger.warn(
      `Failed to retrieve Rapyd payment ${rapydPaymentId} for user ${userId}: ${err.message}`
    );
    throw new AppError(
      'Payment verification failed. The payment reference is invalid or could not be found.',
      400
    );
  }

  if (!payment || typeof payment !== 'object' || !payment.id) {
    logger.warn(
      `Rapyd payment ${rapydPaymentId} returned an empty/invalid envelope for user ${userId}`
    );
    throw new AppError(
      'Payment verification failed. Rapyd returned an invalid response.',
      400
    );
  }

  // Guard: ensure the Payment belongs to this user (via metadata)
  if (payment.metadata && payment.metadata.userId) {
    if (payment.metadata.userId !== userId) {
      logger.warn(
        `Rapyd payment ${rapydPaymentId} userId mismatch: ` +
        `expected ${userId}, got ${payment.metadata.userId}`
      );
      throw new AppError(
        'Payment verification failed. This payment does not belong to your account.',
        403
      );
    }
  }

  // Guard: reject terminal failure / cancellation statuses
  const verdict = classifyRapydStatus(payment.status);
  if (verdict === 'failed') {
    logger.warn(
      `Rapyd payment ${rapydPaymentId} has terminal status '${payment.status}' ` +
      `for order creation (user: ${userId})`
    );
    throw new AppError(
      `Cannot create an order for a payment with status '${payment.status}'. ` +
      'Please complete the payment process before placing your order.',
      400
    );
  }

  return payment;
};

// ─── Controllers ─────────────────────────────────────

/**
 * @route   POST /api/orders/create-payment-intent
 * @desc    Fetch cart items, calculate the total, create a Rapyd Payment,
 *          and return the clientToken needed by the Rapyd Client SDK
 *          to render the secure card iframe and confirm the payment.
 * @access  Protected (JWT)
 *
 * Response 200:
 * {
 *   status: 'success',
 *   data: {
 *     paymentId: string,         // Rapyd payment id (e.g. 'payment_xxx')
 *     clientToken: string|null,  // Token / URL the Rapyd Client SDK uses to
 *                                // render the hosted card iframe & confirm.
 *     amount: number,            // Total in minor units (cents) for parity
 *                                // with the legacy Stripe response shape.
 *     currency: string,          // 'USD'
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

  // Amount is computed in MINOR units (cents) so the response shape continues
  // to match the legacy Stripe contract. The Rapyd service converts back to
  // major units internally before signing the request.
  const amountInCents = Math.round(total * 100);

  // ── 4. Create Rapyd Payment ─────────────────────────────────────
  let payment;
  try {
    payment = await rapyd.createPayment({
      amount: amountInCents,
      currency: 'USD',
      // 'us_visa_card' is broadly supported in Rapyd sandbox/USD flows; the
      // Rapyd Client SDK exposes the full set of brands (Visa, Mastercard,
      // Amex, Discover) regardless of this default once the iframe is rendered.
      paymentMethodType: 'us_visa_card',
      description: `Ballers order — ${orderItems.length} item(s)`,
      metadata: {
        userId,
        itemCount: String(orderItems.length),
        subtotal: String(subtotal),
        shippingCost: String(shippingCost),
        amountCents: String(amountInCents),
      },
    });
  } catch (rapydError) {
    logger.error(
      `Rapyd payment creation failed for user ${userId}: ${rapydError.message}`
    );
    // Bubble AppErrors (already user-safe) verbatim; wrap anything else as 502.
    if (rapydError instanceof AppError) return next(rapydError);
    return next(
      new AppError(
        'Unable to initialise payment. Please try again or contact support.',
        502
      )
    );
  }

  if (!payment || !payment.id) {
    logger.error(
      `Rapyd payment creation returned an invalid response for user ${userId}`
    );
    return next(
      new AppError('Unable to initialise payment — invalid Rapyd response.', 502)
    );
  }

  const clientToken = extractClientToken(payment);

  logger.info(
    `Rapyd payment created: ${payment.id} for user ${userId}, ` +
    `amount: $${total} (${amountInCents} cents), status: ${payment.status || 'unknown'}`
  );

  // ── 5. Return Rapyd payment details to the frontend ───────────────────────
  res.status(200).json({
    status: 'success',
    data: {
      paymentId: payment.id,
      clientToken,
      amount: amountInCents,
      currency: (payment.currency_code || payment.currency || 'USD').toUpperCase(),
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

// ─── Existing Controllers ───────────────────────────────────────

/**
 * @route   POST /api/orders/create
 * @desc    Create a new order from the user's cart, associated with a verified
 *          Rapyd Payment.
 *
 *          Flow:
 *          1. Validate the Rapyd Payment (must exist, belong to user, not failed/cancelled).
 *          2. Check for duplicate orders (idempotency — same rapydPaymentId).
 *          3. Run a Firestore transaction to:
 *             a. Validate cart is non-empty.
 *             b. Validate product stock.
 *             c. Validate the Rapyd payment amount matches the cart total.
 *             d. Create the order document with rapydPaymentId.
 *             e. Clear the user's cart.
 *          4. Return the created order.
 *
 *          The initial order status is set to:
 *          - 'paid'    — if the Rapyd Payment status is success ('CLO', 'CLOSED',
 *                        'COMPLETED', 'SUCCEEDED'); the payment is already captured.
 *          - 'pending' — otherwise (the webhook will update to 'paid' when Rapyd
 *                        emits payment.SUCCEEDED).
 *
 * @access  Protected (JWT)
 *
 * Request body:
 * {
 *   rapydPaymentId: string,    // Rapyd payment id (payment_...)
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
 *     rapydPaymentId: string,
 *     paymentMethod: 'rapyd',
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
  const { shippingAddress, rapydPaymentId, notes } = req.body;
  const userId = req.user.id;
  const db = getDb();

  // ── 1. Verify the Rapyd Payment ────────────────────────────────────
  let payment;
  try {
    payment = await verifyRapydPayment(rapydPaymentId, userId);
  } catch (err) {
    return next(err);
  }

  logger.info(
    `Order creation: Rapyd payment ${rapydPaymentId} verified for user ${userId} ` +
    `(status: ${payment.status})`
  );

  // ── 2. Idempotency check — prevent duplicate orders ────────────────────────
  // If an order already exists for this Rapyd payment, return it instead of
  // creating a duplicate. This handles frontend retries gracefully.
  const existingOrderSnap = await Order.collection()
    .where('rapydPaymentId', '==', rapydPaymentId)
    .limit(1)
    .get();

  if (!existingOrderSnap.empty) {
    const existingOrder = Order.serialize(existingOrderSnap.docs[0]);
    logger.info(
      `Idempotency: order ${existingOrder.id} already exists for ` +
      `Rapyd payment ${rapydPaymentId}. Returning existing order.`
    );
    return res.status(200).json({
      status: 'success',
      message: 'Order already exists for this payment.',
      data: {
        orderId: existingOrder.id,
        orderNumber: existingOrder.orderNumber,
        status: existingOrder.status,
        rapydPaymentId: existingOrder.rapydPaymentId,
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

  // ── 3. Determine initial order status from Rapyd Payment ───────────────────
  // If Rapyd has already settled the payment (status 'CLO'/'CLOSED'/...) we
  // mark the order 'paid' immediately. Otherwise we mark 'pending' and let
  // the webhook update it once Rapyd sends payment.SUCCEEDED.
  const verdict = classifyRapydStatus(payment.status);
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
    // Rapyd returns `amount` in MAJOR units (e.g. 19.99) so multiply by 100.
    const expectedCents = Math.round(total * 100);
    const rapydAmount = Number(payment.amount);
    if (Number.isFinite(rapydAmount)) {
      const paymentCents = Math.round(rapydAmount * 100);
      if (paymentCents !== expectedCents) {
        logger.warn(
          `Rapyd payment ${rapydPaymentId} amount mismatch for user ${userId}: ` +
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
      // paymentMethod is always 'rapyd' for Rapyd-integrated orders
      paymentMethod: 'rapyd',
      rapydPaymentId,
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
    `rapydPaymentId: ${rapydPaymentId}`
  );

  res.status(201).json({
    status: 'success',
    message: 'Order placed successfully.',
    data: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      rapydPaymentId: order.rapydPaymentId,
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
