/**
 * Order Controller
 * Handles order creation and retrieval for authenticated users.
 * POST /api/orders/create - Create a new order from the user's cart
 * GET  /api/orders        - Get paginated order history for the user
 */

const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const Joi = require('joi');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Joi validation schemas
// ---------------------------------------------------------------------------

/** Shipping address schema */
const shippingSchema = Joi.object({
  firstName: Joi.string().trim().min(1).max(50).required(),
  lastName: Joi.string().trim().min(1).max(50).required(),
  email: Joi.string().trim().email().required(),
  address: Joi.string().trim().min(5).max(200).required(),
  city: Joi.string().trim().min(1).max(100).required(),
  zip: Joi.string().trim().min(3).max(20).required(),
  country: Joi.string().trim().min(2).max(100).required(),
  phone: Joi.string().trim().max(30).optional().allow(''),
});

/** Payment info schema (card details are NOT stored – only last 4 digits) */
const paymentSchema = Joi.object({
  method: Joi.string().valid('card', 'paypal').default('card'),
  // For card payments the frontend sends the full number; we only keep last 4
  cardNumber: Joi.string().trim().min(13).max(19).optional(),
  cardHolder: Joi.string().trim().max(100).optional().allow(''),
  expiryMonth: Joi.string().trim().max(2).optional().allow(''),
  expiryYear: Joi.string().trim().max(4).optional().allow(''),
  // CVV is intentionally NOT stored
});

/** Full create-order request schema */
const createOrderSchema = Joi.object({
  shippingAddress: shippingSchema.required(),
  paymentInfo: paymentSchema.required(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely extract the last 4 digits from a card number string.
 * Returns '****' if the value is absent or too short.
 * @param {string|undefined} cardNumber
 * @returns {string}
 */
function maskCardNumber(cardNumber) {
  if (!cardNumber || cardNumber.length < 4) return '****';
  return cardNumber.replace(/\s/g, '').slice(-4);
}

/**
 * Round a floating-point price to 2 decimal places.
 * @param {number} value
 * @returns {number}
 */
function roundPrice(value) {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Controller: createOrder
// ---------------------------------------------------------------------------

/**
 * POST /api/orders/create
 *
 * Creates a new order from the authenticated user's active cart.
 * Steps:
 *  1. Validate request body (shipping + payment).
 *  2. Load the user's cart (with populated product refs).
 *  3. Verify the cart is non-empty.
 *  4. Re-validate product prices server-side to prevent price tampering.
 *  5. Persist the Order document.
 *  6. Clear the cart.
 *  7. Return the created order.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function createOrder(req, res, next) {
  try {
    // 1. Validate request body
    const { error, value } = createOrderSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.details.map((d) => d.message),
      });
    }

    const { shippingAddress, paymentInfo } = value;
    const userId = req.user.id;

    // 2. Load the user's cart with product details
    const cart = await Cart.findOne({ user: userId }).populate({
      path: 'items.product',
      select: 'name price images team',
    });

    // 3. Verify cart exists and is non-empty
    if (!cart || !cart.items || cart.items.length === 0) {
      return res.status(400).json({
        error: 'Cart is empty. Add items before placing an order.',
      });
    }

    // 4. Build order items and re-calculate totals server-side
    const orderItems = [];
    let calculatedSubtotal = 0;

    for (const cartItem of cart.items) {
      // Guard against deleted products
      if (!cartItem.product) {
        return res.status(400).json({
          error: 'One or more products in your cart are no longer available.',
        });
      }

      const unitPrice = roundPrice(cartItem.product.price);
      const quantity = cartItem.quantity || 1;
      const lineTotal = roundPrice(unitPrice * quantity);

      calculatedSubtotal = roundPrice(calculatedSubtotal + lineTotal);

      orderItems.push({
        product: cartItem.product._id,
        name: cartItem.product.name,
        image: cartItem.product.images && cartItem.product.images[0]
          ? cartItem.product.images[0]
          : '',
        price: unitPrice,
        quantity,
        customization: {
          playerName: cartItem.customization ? cartItem.customization.playerName : '',
          playerNumber: cartItem.customization ? cartItem.customization.playerNumber : '',
          size: cartItem.customization ? cartItem.customization.size : 'M',
        },
      });
    }

    // Simple shipping logic: free for orders >= $100, otherwise $9.99
    const shippingCost = calculatedSubtotal >= 100 ? 0 : 9.99;
    const taxRate = 0.08; // 8 % flat tax
    const taxAmount = roundPrice(calculatedSubtotal * taxRate);
    const totalAmount = roundPrice(calculatedSubtotal + shippingCost + taxAmount);

    // 5. Build and save the Order document
    const order = new Order({
      user: userId,
      items: orderItems,
      shippingAddress: {
        firstName: shippingAddress.firstName,
        lastName: shippingAddress.lastName,
        email: shippingAddress.email,
        address: shippingAddress.address,
        city: shippingAddress.city,
        zip: shippingAddress.zip,
        country: shippingAddress.country,
        phone: shippingAddress.phone || '',
      },
      paymentInfo: {
        method: paymentInfo.method || 'card',
        // Store only the last 4 digits – never the full card number
        last4: paymentInfo.method === 'card'
          ? maskCardNumber(paymentInfo.cardNumber)
          : '',
        cardHolder: paymentInfo.cardHolder || '',
      },
      subtotal: calculatedSubtotal,
      shippingCost,
      taxAmount,
      totalAmount,
      status: 'pending',
    });

    await order.save();

    // 6. Clear the user's cart
    cart.items = [];
    await cart.save();

    logger.info(`Order created: ${order._id} for user: ${userId}`);

    // 7. Return the created order
    return res.status(201).json({
      message: 'Order placed successfully',
      order: {
        id: order._id,
        status: order.status,
        items: order.items,
        shippingAddress: order.shippingAddress,
        paymentInfo: {
          method: order.paymentInfo.method,
          last4: order.paymentInfo.last4,
        },
        subtotal: order.subtotal,
        shippingCost: order.shippingCost,
        taxAmount: order.taxAmount,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
      },
    });
  } catch (err) {
    logger.error('createOrder error:', err);
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Controller: getOrders
// ---------------------------------------------------------------------------

/**
 * GET /api/orders
 *
 * Returns a paginated list of orders for the authenticated user.
 * Query params:
 *  - page  {number} default 1
 *  - limit {number} default 10, max 50
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getOrders(req, res, next) {
  try {
    const userId = req.user.id;

    // Parse and clamp pagination params
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    // Fetch orders for this user, newest first
    const [orders, total] = await Promise.all([
      Order.find({ user: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('-__v')
        .lean(),
      Order.countDocuments({ user: userId }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      orders: orders.map((o) => ({
        id: o._id,
        status: o.status,
        items: o.items,
        shippingAddress: o.shippingAddress,
        paymentInfo: {
          method: o.paymentInfo.method,
          last4: o.paymentInfo.last4,
        },
        subtotal: o.subtotal,
        shippingCost: o.shippingCost,
        taxAmount: o.taxAmount,
        totalAmount: o.totalAmount,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (err) {
    logger.error('getOrders error:', err);
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Controller: getOrderById
// ---------------------------------------------------------------------------

/**
 * GET /api/orders/:id
 *
 * Returns a single order by ID, ensuring it belongs to the requesting user.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getOrderById(req, res, next) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Validate ObjectId format to avoid CastError
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({ error: 'Invalid order ID format.' });
    }

    const order = await Order.findOne({ _id: id, user: userId })
      .select('-__v')
      .lean();

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    return res.status(200).json({
      order: {
        id: order._id,
        status: order.status,
        items: order.items,
        shippingAddress: order.shippingAddress,
        paymentInfo: {
          method: order.paymentInfo.method,
          last4: order.paymentInfo.last4,
        },
        subtotal: order.subtotal,
        shippingCost: order.shippingCost,
        taxAmount: order.taxAmount,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
    });
  } catch (err) {
    logger.error('getOrderById error:', err);
    next(err);
  }
}

module.exports = { createOrder, getOrders, getOrderById };
