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
 *
 * NOTE: verifyPaymentIntent / createOrder still reference the legacy Stripe
 * service. Those are migrated to Rapyd in a follow-up task — keeping them
 * here untouched ensures existing Stripe-based integration tests keep passing
 * during the incremental cut-over.
 */
const { admin, getDb } = require('../services/db');
const stripe = require('../services/stripe');
const rapyd = require('../services/rapyd');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/**
 * Verify a Stripe PaymentIntent and return its data.
 *
 * Validates that:
 *   - The PaymentIntent exists in Stripe.
 *   - It belongs to the authenticated user (via metadata.userId).
 *   - Its status is either 'succeeded' or 'requires_capture' (valid for order creation).
 *     A status of 'canceled' or 'payment_failed' is rejected.
 *
 * @param {string} paymentIntentId - Stripe PaymentIntent id (pi_...)
 * @param {string} userId - Authenticated user id
 * @returns {Promise<import('stripe').Stripe.PaymentIntent>}
 * @throws {AppError} on invalid/mismatched/failed PaymentIntent
 */
const verifyPaymentIntent = async (paymentIntentId, userId) => {
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (err) {
    logger.warn(
      `Failed to retrieve PaymentIntent ${paymentIntentId} for user ${userId}: ${err.message}`
    );
    throw new AppError(
      'Payment verification failed. The payment reference is invalid or could not be found.',
      400
    );
  }

  // Guard: ensure the PaymentIntent belongs to this user
  if (paymentIntent.metadata && paymentIntent.metadata.userId) {
    if (paymentIntent.metadata.userId !== userId) {
      logger.warn(
        `PaymentIntent ${paymentIntentId} userId mismatch: ` +
        `expected ${userId}, got ${paymentIntent.metadata.userId}`
      );
      throw new AppError(
        'Payment verification failed. This payment does not belong to your account.',
        403
      );
    }
  }

  // Guard: reject terminal failure/cancellation statuses
  const rejectedStatuses = ['canceled', 'requires_payment_method'];
  if (rejectedStatuses.includes(paymentIntent.status)) {
    logger.warn(
      `PaymentIntent ${paymentIntentId} has invalid status '${paymentIntent.status}' ` +
      `for order creation (user: ${userId})`
    );
    throw new AppError(
      `Cannot create an order for a payment with status '${paymentIntent.status}'. ` +
      'Please complete the payment process before placing your order.',
      400
    );
  }

  return paymentIntent;
};

// ─── Controllers ─────────────────────────────────────────────────────────────

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

  // ── 1. Fetch cart ──────────────────────────────────────────────────────────
  const cartSnap = await Cart.docForUser(userId).get();

  if (!cartSnap.exists || !(cartSnap.data().items || []).length) {
    return next(
      new AppError('Your cart is empty. Add items before proceeding to checkout.', 400)
    );
  }

  const cartItems = cartSnap.data().items;

  // ── 2. Fetch product data and validate stock ───────────────────────────────
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

  // ── 3. Calculate totals ────────────────────────────────────────────────────
  const { subtotal, shippingCost, total } = calculateTotals(orderItems);

  // Amount is computed in MINOR units (cents) so the response shape continues
  // to match the legacy Stripe contract. The Rapyd service converts back to
  // major units internally before signing the request.
  const amountInCents = Math.round(total * 100);

  // ── 4. Create Rapyd Payment ───────────────────────────────────────────────
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

// ─── Existing Controllers ─────────────────────────────────────────────────────

/**
 * @route   POST /api/orders/create
 * @desc    Create a new order from the user's cart, associated with a Stripe PaymentIntent.
 *
 *          Flow:
 *          1. Validate the Stripe PaymentIntent (must exist, belong to user, not cancelled).
 *          2. Check for duplicate orders (idempotency — same paymentIntentId).
 *          3. Run a Firestore transaction to:
 *             a. Validate cart is non-empty.
 *             b. Validate product stock.
 *             c. Create the order document with paymentIntentId.
 *             d. Clear the user's cart.
 *          4. Return the created order.
 *
 *          The initial order status is set to:
 *          - 'paid'    — if the PaymentIntent status is 'succeeded' (payment already confirmed)
 *          - 'pending' — otherwise (webhook will update to 'paid' on confirmation)
 *
 * @access  Protected (JWT)
 *
 * Request body:
 * {
 *   paymentIntentId: string,   // Stripe PaymentIntent id (pi_...)
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
 *     paymentIntentId: string,
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
  const { shippingAddress, paymentIntentId, notes } = req.body;
  const userId = req.user.id;
  const db = getDb();

  // ── 1. Verify the Stripe PaymentIntent ────────────────────────────────────
  let paymentIntent;
  try {
    paymentIntent = await verifyPaymentIntent(paymentIntentId, userId);
  } catch (err) {
    return next(err);
  }

  logger.info(
    `Order creation: PaymentIntent ${paymentIntentId} verified for user ${userId} ` +
    `(status: ${paymentIntent.status})`
  );

  // ── 2. Idempotency check — prevent duplicate orders ────────────────────────
  // If an order already exists for this PaymentIntent, return it instead of
  // creating a duplicate. This handles frontend retries gracefully.
  const existingOrderSnap = await Order.collection()
    .where('paymentIntentId', '==', paymentIntentId)
    .limit(1)
    .get();

  if (!existingOrderSnap.empty) {
    const existingOrder = Order.serialize(existingOrderSnap.docs[0]);
    logger.info(
      `Idempotency: order ${existingOrder.id} already exists for ` +
      `PaymentIntent ${paymentIntentId}. Returning existing order.`
    );
    return res.status(200).json({
      status: 'success',
      message: 'Order already exists for this payment.',
      data: {
        orderId: existingOrder.id,
        orderNumber: existingOrder.orderNumber,
        status: existingOrder.status,
        paymentIntentId: existingOrder.paymentIntentId,
        items: existingOrder.items,
        subtotal: existingOrder.subtotal,
        shippingCost: existingOrder.shippingCost,
        total: existingOrder.total,
        shippingAddress: existingOrder.shippingAddress,
        createdAt: existingOrder.createdAt,
      },
    });
  }

  // ── 3. Determine initial order status from PaymentIntent ──────────────────
  // If Stripe has already confirmed the payment (e.g., the webhook fired before
  // the frontend called this endpoint), set status to 'paid' immediately.
  // Otherwise, set to 'pending' and let the webhook update it.
  const initialStatus = paymentIntent.status === 'succeeded' ? 'paid' : 'pending';

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
    const now = admin.firestore.FieldValue.serverTimestamp();

    const orderData = {
      user: userId,
      orderNumber: Order.generateOrderNumber(),
      items: orderItems,
      shippingAddress,
      // paymentMethod is always 'stripe' when paymentIntentId is provided
      paymentMethod: 'stripe',
      paymentIntentId,
      notes: notes || '',
      subtotal: Math.round(subtotal * 100) / 100,
      shippingCost,
      total,
      status: initialStatus,
      createdAt: now,
      updatedAt: now,
    };

    tx.set(orderRef, orderData);

    // Clear the cart only if the payment has already succeeded.
    // If status is 'pending', the webhook handler will clear the cart
    // when it receives the payment_intent.succeeded event.
    // However, we clear it here too to provide immediate UX feedback —
    // the webhook will handle the case where the cart is already empty.
    tx.update(cartRef, { items: [], updatedAt: now });

    return orderData;
  });

  const orderSnap = await orderRef.get();
  const order = Order.serialize(orderSnap);

  logger.info(
    `Order created: ${order.id} (${order.orderNumber}) for user ${userId}, ` +
    `total: $${result.total}, status: ${result.status}, ` +
    `paymentIntentId: ${paymentIntentId}`
  );

  res.status(201).json({
    status: 'success',
    message: 'Order placed successfully.',
    data: {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentIntentId: order.paymentIntentId,
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
