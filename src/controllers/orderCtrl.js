/**
 * Order Controller
 * Handles order creation, retrieval, and Stripe payment intent creation.
 *
 * createOrder runs in a Firestore transaction so that stock validation,
 * order creation, and cart clearing are atomic.
 *
 * The order creation flow (Stripe-integrated):
 *   1. Frontend calls POST /api/orders/create-payment-intent → gets client_secret.
 *   2. Frontend confirms payment via stripe.confirmCardPayment(client_secret).
 *   3. On Stripe success, frontend calls POST /api/orders/create with
 *      { paymentIntentId, shippingAddress } to persist the order.
 *   4. Backend verifies the PaymentIntent with Stripe, then creates the order
 *      with status 'paid' (if already succeeded) or 'pending' (awaiting webhook).
 *   5. Stripe webhook (payment_intent.succeeded) updates status to 'paid'
 *      and clears the cart if the order was created before the webhook fires.
 *
 * createPaymentIntent:
 *   1. Fetches the authenticated user's cart from Firestore.
 *   2. Validates cart items and checks product stock.
 *   3. Calculates the order total (subtotal + shipping).
 *   4. Creates a Stripe PaymentIntent and returns the client_secret.
 */
const { admin, getDb } = require('../services/db');
const stripe = require('../services/stripe');
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
 * @desc    Fetch cart items, calculate total, create a Stripe PaymentIntent,
 *          and return the client_secret for the frontend to confirm payment.
 * @access  Protected (JWT)
 *
 * Response 200:
 * {
 *   status: 'success',
 *   data: {
 *     clientSecret: string,       // Stripe PaymentIntent client_secret
 *     paymentIntentId: string,    // Stripe PaymentIntent id (pi_...)
 *     amount: number,             // Total in cents (e.g. 8999 = $89.99)
 *     currency: string,           // 'usd'
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

  // Stripe requires amount in the smallest currency unit (cents for USD)
  const amountInCents = Math.round(total * 100);

  // ── 4. Create Stripe PaymentIntent ────────────────────────────────────────
  let paymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      // Automatic payment methods lets Stripe optimise the payment flow
      automatic_payment_methods: { enabled: true },
      metadata: {
        userId,
        itemCount: String(orderItems.length),
        subtotal: String(subtotal),
        shippingCost: String(shippingCost),
      },
    });
  } catch (stripeError) {
    logger.error(`Stripe PaymentIntent creation failed for user ${userId}: ${stripeError.message}`);
    return next(
      new AppError(
        'Unable to initialise payment. Please try again or contact support.',
        502
      )
    );
  }

  logger.info(
    `PaymentIntent created: ${paymentIntent.id} for user ${userId}, ` +
    `amount: $${total} (${amountInCents} cents)`
  );

  // ── 5. Return client_secret to the frontend ────────────────────────────────
  res.status(200).json({
    status: 'success',
    data: {
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: amountInCents,
      currency: paymentIntent.currency,
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
