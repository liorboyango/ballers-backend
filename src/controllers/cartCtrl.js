/**
 * Cart Controller
 * Manages the user's shopping cart (add, view, update, remove items).
 */

const Cart = require('../models/Cart');
const Product = require('../models/Product');
const logger = require('../utils/logger');

/**
 * GET /api/cart
 * Returns the authenticated user's cart with populated product details.
 */
const getCart = async (req, res, next) => {
  try {
    let cart = await Cart.findOne({ user: req.user._id }).populate(
      'items.product',
      'name images price team kitType customization'
    );

    if (!cart) {
      cart = { user: req.user._id, items: [], total: 0, itemCount: 0 };
    }

    res.status(200).json({ cart });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/cart/add
 * Add an item to the cart. If the same product+size+customization exists, increment quantity.
 */
const addToCart = async (req, res, next) => {
  try {
    const { productId, quantity = 1, size, customization = {} } = req.body;

    // Verify product exists and is active
    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      return res.status(404).json({ error: 'Product not found' });
    }

    // Check stock
    const stockForSize = product.stock.get(size);
    if (stockForSize === undefined || stockForSize < quantity) {
      return res.status(400).json({ error: `Insufficient stock for size ${size}` });
    }

    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      cart = new Cart({ user: req.user._id, items: [] });
    }

    // Check if same product+size+customization already in cart
    const existingIndex = cart.items.findIndex(
      (item) =>
        item.product.toString() === productId &&
        item.size === size &&
        item.customization.number === (customization.number || '') &&
        item.customization.name === (customization.name || '')
    );

    if (existingIndex > -1) {
      cart.items[existingIndex].quantity += quantity;
    } else {
      cart.items.push({
        product: productId,
        quantity,
        size,
        customization: {
          number: customization.number || '',
          name: customization.name || '',
          sponsor: customization.sponsor || '',
        },
        price: product.price,
      });
    }

    await cart.save();
    await cart.populate('items.product', 'name images price team kitType');

    logger.info(`Cart updated for user ${req.user._id}`);
    res.status(200).json({ message: 'Item added to cart', cart });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/cart/update
 * Update quantity of a specific cart item by itemId.
 */
const updateCartItem = async (req, res, next) => {
  try {
    const { itemId, quantity } = req.body;

    if (!quantity || quantity < 1) {
      return res.status(400).json({ error: 'Quantity must be at least 1' });
    }

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    const item = cart.items.id(itemId);
    if (!item) {
      return res.status(404).json({ error: 'Cart item not found' });
    }

    item.quantity = quantity;
    await cart.save();
    await cart.populate('items.product', 'name images price team kitType');

    res.status(200).json({ message: 'Cart updated', cart });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/cart/item
 * Remove a specific item from the cart by itemId.
 */
const removeCartItem = async (req, res, next) => {
  try {
    const { itemId } = req.body;

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    const itemIndex = cart.items.findIndex((item) => item._id.toString() === itemId);
    if (itemIndex === -1) {
      return res.status(404).json({ error: 'Cart item not found' });
    }

    cart.items.splice(itemIndex, 1);
    await cart.save();
    await cart.populate('items.product', 'name images price team kitType');

    res.status(200).json({ message: 'Item removed from cart', cart });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/cart
 * Clear all items from the cart.
 */
const clearCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({ error: 'Cart not found' });
    }

    cart.items = [];
    await cart.save();

    res.status(200).json({ message: 'Cart cleared', cart });
  } catch (err) {
    next(err);
  }
};

module.exports = { getCart, addToCart, updateCartItem, removeCartItem, clearCart };
