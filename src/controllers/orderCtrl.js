/**
 * Order Controller
 * Handles order creation and retrieval.
 * Orders are created from the user's current cart.
 */
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

/**
 * POST /api/orders/create
 * Create a new order from the user's current cart
 * @body {Object} shippingAddress - Delivery address details
 * @body {string} [paymentMethod='card'] - Payment method
 * @body {string} [notes] - Optional order notes
 */
exports.createOrder = asyncHandler(async (req, res, next) => {
  const { shippingAddress, paymentMethod = 'card', notes } = req.body;

  // Get user's cart with product details
  const cart = await Cart.findOne({ user: req.user.id }).populate({
    path: 'items.product',
    select: 'name price stock team kitType',
  });

  if (!cart || cart.items.length === 0) {
    return next(new AppError('Your cart is empty. Add items before placing an order.', 400));
  }

  // Validate stock availability for all items
  const stockErrors = [];
  for (const item of cart.items) {
    if (!item.product) {
      stockErrors.push({ field: 'cart', message: 'One or more products in your cart no longer exist.' });
      continue;
    }
    if (item.product.stock !== undefined && item.product.stock < item.quantity) {
      stockErrors.push({
        field: item.product.name,
        message: `Only ${item.product.stock} unit(s) available for "${item.product.name}".`,
      });
    }
  }

  if (stockErrors.length > 0) {
    return next(new AppError('Some items in your cart are out of stock.', 400, stockErrors));
  }

  // Calculate order total
  const orderItems = cart.items.map((item) => ({
    product: item.product._id,
    name: item.product.name,
    price: item.product.price,
    quantity: item.quantity,
    customization: item.customization,
  }));

  const subtotal = orderItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const shippingCost = subtotal >= 100 ? 0 : 9.99; // Free shipping over $100
  const total = Math.round((subtotal + shippingCost) * 100) / 100;

  // Create order
  const order = await Order.create({
    user: req.user.id,
    items: orderItems,
    shippingAddress,
    paymentMethod,
    notes: notes || '',
    subtotal: Math.round(subtotal * 100) / 100,
    shippingCost,
    total,
    status: 'pending',
  });

  // Clear the cart after successful order creation
  cart.items = [];
  await cart.save();

  logger.info(`Order created: ${order._id} for user ${req.user.id}, total: $${total}`);

  res.status(201).json({
    status: 'success',
    message: 'Order placed successfully.',
    data: {
      orderId: order._id,
      orderNumber: order.orderNumber,
      status: order.status,
      items: order.items,
      subtotal: order.subtotal,
      shippingCost: order.shippingCost,
      total: order.total,
      shippingAddress: order.shippingAddress,
      createdAt: order.createdAt,
    },
  });
});

/**
 * GET /api/orders
 * Get all orders for the authenticated user with pagination
 * @query {number} [page=1] - Page number
 * @query {number} [limit=10] - Items per page
 * @query {string} [status] - Filter by order status
 * @query {string} [sort] - Sort field
 */
exports.getOrders = asyncHandler(async (req, res, next) => {
  const { page = 1, limit = 10, status, sort } = req.query;

  const filter = { user: req.user.id };
  if (status) filter.status = status;

  let sortObj = { createdAt: -1 };
  if (sort) {
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    const sortOrder = sort.startsWith('-') ? -1 : 1;
    sortObj = { [sortField]: sortOrder };
  }

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Order.countDocuments(filter),
  ]);

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

/**
 * GET /api/orders/:id
 * Get a specific order by ID (must belong to authenticated user)
 * @param {string} id - MongoDB ObjectId of the order
 */
exports.getOrderById = asyncHandler(async (req, res, next) => {
  const order = await Order.findOne({
    _id: req.params.id,
    user: req.user.id,
  }).lean();

  if (!order) {
    return next(new AppError('Order not found.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: order,
  });
});
