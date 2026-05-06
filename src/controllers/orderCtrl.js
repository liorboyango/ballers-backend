/**
 * Order Controller
 * Handles order creation from cart and order history retrieval.
 */

const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const logger = require('../utils/logger');

/**
 * POST /api/orders/create
 * Create a new order from the user's current cart.
 * Clears the cart on success.
 */
const createOrder = async (req, res, next) => {
  try {
    const { shippingAddress, notes } = req.body;

    // Load cart with product details
    const cart = await Cart.findOne({ user: req.user._id }).populate(
      'items.product',
      'name price team isActive'
    );

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Validate all products are still active
    for (const item of cart.items) {
      if (!item.product || !item.product.isActive) {
        return res.status(400).json({
          error: `Product "${item.product?.name || 'unknown'}" is no longer available`,
        });
      }
    }

    // Build order items snapshot (prices locked at time of order)
    const orderItems = await Promise.all(
      cart.items.map(async (item) => {
        const product = await Product.findById(item.product._id).populate('team', 'name');
        return {
          product: item.product._id,
          productName: item.product.name,
          teamName: product.team?.name || 'Unknown',
          quantity: item.quantity,
          size: item.size,
          price: item.price,
          customization: item.customization,
        };
      })
    );

    const subtotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const shippingCost = subtotal >= 100 ? 0 : 9.99; // Free shipping over $100
    const total = subtotal + shippingCost;

    const order = await Order.create({
      user: req.user._id,
      items: orderItems,
      shippingAddress,
      subtotal: parseFloat(subtotal.toFixed(2)),
      shippingCost: parseFloat(shippingCost.toFixed(2)),
      total: parseFloat(total.toFixed(2)),
      notes,
    });

    // Clear the cart after successful order
    cart.items = [];
    await cart.save();

    logger.info(`Order created: ${order.orderNumber} for user ${req.user._id}`);

    res.status(201).json({
      message: 'Order placed successfully',
      order: {
        id: order._id,
        orderNumber: order.orderNumber,
        total: order.total,
        status: order.status,
        createdAt: order.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/orders
 * Returns the authenticated user's order history (paginated).
 */
const getOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const total = await Order.countDocuments({ user: req.user._id });
    const orders = await Order.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10));

    res.status(200).json({
      orders,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        pages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/orders/:id
 * Returns a single order by ID (must belong to the authenticated user).
 */
const getOrderById = async (req, res, next) => {
  try {
    const order = await Order.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.status(200).json({ order });
  } catch (err) {
    next(err);
  }
};

module.exports = { createOrder, getOrders, getOrderById };
