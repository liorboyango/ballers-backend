/**
 * Cart Controller
 * Manages shopping cart operations for authenticated users.
 * Cart is stored in MongoDB and linked to the user's account.
 */
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

/**
 * GET /api/cart
 * Retrieve the current user's cart with populated product details
 */
exports.getCart = asyncHandler(async (req, res, next) => {
  let cart = await Cart.findOne({ user: req.user.id })
    .populate({
      path: 'items.product',
      select: 'name price imageUrl team kitType sizes stock',
      populate: { path: 'team', select: 'name country flagUrl' },
    })
    .lean();

  if (!cart) {
    // Return empty cart structure if none exists
    return res.status(200).json({
      status: 'success',
      data: {
        items: [],
        subtotal: 0,
        itemCount: 0,
      },
    });
  }

  // Calculate totals
  const subtotal = cart.items.reduce((sum, item) => {
    const price = item.product ? item.product.price : 0;
    return sum + price * item.quantity;
  }, 0);

  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

  res.status(200).json({
    status: 'success',
    data: {
      ...cart,
      subtotal: Math.round(subtotal * 100) / 100,
      itemCount,
    },
  });
});

/**
 * POST /api/cart/add
 * Add a product to the cart or increase quantity if already present
 * @body {string} productId - MongoDB ObjectId of the product
 * @body {number} [quantity=1] - Quantity to add (1-10)
 * @body {Object} customization - Customization options
 * @body {string} customization.size - Required size selection
 * @body {string} [customization.playerName] - Optional player name
 * @body {number} [customization.playerNumber] - Optional player number (1-99)
 */
exports.addToCart = asyncHandler(async (req, res, next) => {
  const { productId, quantity = 1, customization } = req.body;

  // Verify product exists and is in stock
  const product = await Product.findById(productId);
  if (!product) {
    return next(new AppError('Product not found.', 404));
  }

  if (product.stock !== undefined && product.stock < quantity) {
    return next(
      new AppError(
        `Insufficient stock. Only ${product.stock} item(s) available.`,
        400
      )
    );
  }

  // Validate size is available for this product
  if (!product.sizes.includes(customization.size)) {
    return next(
      new AppError(
        `Size ${customization.size} is not available for this product. Available sizes: ${product.sizes.join(', ')}.`,
        400
      )
    );
  }

  // Find or create cart
  let cart = await Cart.findOne({ user: req.user.id });
  if (!cart) {
    cart = new Cart({ user: req.user.id, items: [] });
  }

  // Check if same product+customization already in cart
  const existingItemIndex = cart.items.findIndex(
    (item) =>
      item.product.toString() === productId &&
      item.customization.size === customization.size &&
      item.customization.playerName === (customization.playerName || '') &&
      item.customization.playerNumber === (customization.playerNumber || null)
  );

  if (existingItemIndex > -1) {
    // Update quantity of existing item
    const newQuantity = cart.items[existingItemIndex].quantity + quantity;
    if (newQuantity > 10) {
      return next(new AppError('Maximum quantity per item is 10.', 400));
    }
    cart.items[existingItemIndex].quantity = newQuantity;
  } else {
    // Add new item
    cart.items.push({
      product: productId,
      quantity,
      customization: {
        size: customization.size,
        playerName: customization.playerName || '',
        playerNumber: customization.playerNumber || null,
      },
    });
  }

  await cart.save();

  // Return populated cart
  await cart.populate({
    path: 'items.product',
    select: 'name price imageUrl team kitType',
    populate: { path: 'team', select: 'name country' },
  });

  const itemCount = cart.items.reduce((sum, item) => sum + item.quantity, 0);

  logger.info(`Item added to cart for user ${req.user.id}: product ${productId}`);

  res.status(200).json({
    status: 'success',
    message: 'Item added to cart.',
    data: {
      ...cart.toObject(),
      itemCount,
    },
  });
});

/**
 * PUT /api/cart/update
 * Update the quantity of a specific cart item
 * @body {string} itemId - MongoDB ObjectId of the cart item
 * @body {number} quantity - New quantity (1-10)
 */
exports.updateCartItem = asyncHandler(async (req, res, next) => {
  const { itemId, quantity } = req.body;

  const cart = await Cart.findOne({ user: req.user.id });
  if (!cart) {
    return next(new AppError('Cart not found.', 404));
  }

  const itemIndex = cart.items.findIndex(
    (item) => item._id.toString() === itemId
  );

  if (itemIndex === -1) {
    return next(new AppError('Cart item not found.', 404));
  }

  cart.items[itemIndex].quantity = quantity;
  await cart.save();

  await cart.populate({
    path: 'items.product',
    select: 'name price imageUrl team kitType',
    populate: { path: 'team', select: 'name country' },
  });

  const subtotal = cart.items.reduce((sum, item) => {
    const price = item.product ? item.product.price : 0;
    return sum + price * item.quantity;
  }, 0);

  res.status(200).json({
    status: 'success',
    message: 'Cart updated.',
    data: {
      ...cart.toObject(),
      subtotal: Math.round(subtotal * 100) / 100,
      itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
    },
  });
});

/**
 * DELETE /api/cart/item
 * Remove a specific item from the cart
 * @query {string} itemId - MongoDB ObjectId of the cart item to remove
 */
exports.removeCartItem = asyncHandler(async (req, res, next) => {
  const { itemId } = req.query;

  const cart = await Cart.findOne({ user: req.user.id });
  if (!cart) {
    return next(new AppError('Cart not found.', 404));
  }

  const initialLength = cart.items.length;
  cart.items = cart.items.filter((item) => item._id.toString() !== itemId);

  if (cart.items.length === initialLength) {
    return next(new AppError('Cart item not found.', 404));
  }

  await cart.save();

  logger.info(`Item ${itemId} removed from cart for user ${req.user.id}`);

  res.status(200).json({
    status: 'success',
    message: 'Item removed from cart.',
    data: {
      itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
    },
  });
});

/**
 * DELETE /api/cart
 * Clear all items from the cart
 */
exports.clearCart = asyncHandler(async (req, res, next) => {
  const cart = await Cart.findOne({ user: req.user.id });
  if (!cart) {
    return res.status(200).json({
      status: 'success',
      message: 'Cart is already empty.',
    });
  }

  cart.items = [];
  await cart.save();

  res.status(200).json({
    status: 'success',
    message: 'Cart cleared.',
    data: { items: [], subtotal: 0, itemCount: 0 },
  });
});
