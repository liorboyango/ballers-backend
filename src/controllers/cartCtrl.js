/**
 * Cart Controller
 * Handles all cart-related business logic:
 * - Add item to cart
 * - Get user's cart
 * - Update item quantity/customization
 * - Remove item from cart
 */

const Cart = require('../models/Cart');
const Product = require('../models/Product');

/**
 * @desc    Add item to cart
 * @route   POST /api/cart/add
 * @access  Protected
 */
const addToCart = async (req, res, next) => {
  try {
    const { productId, quantity = 1, customization } = req.body;
    const userId = req.user.id;

    // Validate product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
      });
    }

    // Validate quantity
    if (quantity < 1 || quantity > 99) {
      return res.status(400).json({
        success: false,
        error: 'Quantity must be between 1 and 99',
      });
    }

    // Validate customization size if provided
    if (customization && customization.size) {
      const validSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
      if (!validSizes.includes(customization.size)) {
        return res.status(400).json({
          success: false,
          error: `Invalid size. Must be one of: ${validSizes.join(', ')}`,
        });
      }
    }

    // Validate jersey number if provided
    if (customization && customization.number !== undefined) {
      const num = parseInt(customization.number, 10);
      if (isNaN(num) || num < 1 || num > 99) {
        return res.status(400).json({
          success: false,
          error: 'Jersey number must be between 1 and 99',
        });
      }
    }

    // Find or create cart for user
    let cart = await Cart.findOne({ user: userId });

    if (!cart) {
      cart = new Cart({
        user: userId,
        items: [],
      });
    }

    // Check if same product with same customization already exists
    const existingItemIndex = cart.items.findIndex((item) => {
      if (item.product.toString() !== productId) return false;
      // Compare customization
      const itemCustom = item.customization || {};
      const newCustom = customization || {};
      return (
        itemCustom.size === newCustom.size &&
        itemCustom.number === newCustom.number &&
        itemCustom.name === newCustom.name
      );
    });

    if (existingItemIndex > -1) {
      // Update quantity of existing item
      const newQty = cart.items[existingItemIndex].quantity + quantity;
      if (newQty > 99) {
        return res.status(400).json({
          success: false,
          error: 'Maximum quantity per item is 99',
        });
      }
      cart.items[existingItemIndex].quantity = newQty;
    } else {
      // Add new item
      cart.items.push({
        product: productId,
        quantity,
        price: product.price,
        customization: customization || {},
      });
    }

    await cart.save();

    // Populate product details for response
    await cart.populate('items.product', 'name price images team');

    res.status(200).json({
      success: true,
      message: 'Item added to cart',
      data: cart,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get user's cart
 * @route   GET /api/cart
 * @access  Protected
 */
const getCart = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const cart = await Cart.findOne({ user: userId }).populate(
      'items.product',
      'name price images team slug'
    );

    if (!cart) {
      // Return empty cart if none exists
      return res.status(200).json({
        success: true,
        data: {
          user: userId,
          items: [],
          totalItems: 0,
          totalPrice: 0,
        },
      });
    }

    // Calculate totals
    const totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    const totalPrice = cart.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    res.status(200).json({
      success: true,
      data: {
        _id: cart._id,
        user: cart.user,
        items: cart.items,
        totalItems,
        totalPrice: Math.round(totalPrice * 100) / 100,
        updatedAt: cart.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update cart item (quantity or customization)
 * @route   PUT /api/cart/update
 * @access  Protected
 */
const updateCartItem = async (req, res, next) => {
  try {
    const { itemId, quantity, customization } = req.body;
    const userId = req.user.id;

    if (!itemId) {
      return res.status(400).json({
        success: false,
        error: 'itemId is required',
      });
    }

    // Validate quantity if provided
    if (quantity !== undefined) {
      if (quantity < 1 || quantity > 99) {
        return res.status(400).json({
          success: false,
          error: 'Quantity must be between 1 and 99',
        });
      }
    }

    // Validate customization size if provided
    if (customization && customization.size) {
      const validSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
      if (!validSizes.includes(customization.size)) {
        return res.status(400).json({
          success: false,
          error: `Invalid size. Must be one of: ${validSizes.join(', ')}`,
        });
      }
    }

    // Validate jersey number if provided
    if (customization && customization.number !== undefined) {
      const num = parseInt(customization.number, 10);
      if (isNaN(num) || num < 1 || num > 99) {
        return res.status(400).json({
          success: false,
          error: 'Jersey number must be between 1 and 99',
        });
      }
    }

    const cart = await Cart.findOne({ user: userId });

    if (!cart) {
      return res.status(404).json({
        success: false,
        error: 'Cart not found',
      });
    }

    // Find the item in the cart
    const itemIndex = cart.items.findIndex(
      (item) => item._id.toString() === itemId
    );

    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Item not found in cart',
      });
    }

    // Update quantity if provided
    if (quantity !== undefined) {
      cart.items[itemIndex].quantity = quantity;
    }

    // Update customization if provided
    if (customization !== undefined) {
      cart.items[itemIndex].customization = {
        ...cart.items[itemIndex].customization,
        ...customization,
      };
    }

    await cart.save();

    // Populate product details for response
    await cart.populate('items.product', 'name price images team slug');

    // Calculate totals
    const totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    const totalPrice = cart.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    res.status(200).json({
      success: true,
      message: 'Cart item updated',
      data: {
        _id: cart._id,
        user: cart.user,
        items: cart.items,
        totalItems,
        totalPrice: Math.round(totalPrice * 100) / 100,
        updatedAt: cart.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Remove item from cart
 * @route   DELETE /api/cart/item
 * @access  Protected
 */
const removeCartItem = async (req, res, next) => {
  try {
    const { itemId } = req.body;
    const userId = req.user.id;

    if (!itemId) {
      return res.status(400).json({
        success: false,
        error: 'itemId is required',
      });
    }

    const cart = await Cart.findOne({ user: userId });

    if (!cart) {
      return res.status(404).json({
        success: false,
        error: 'Cart not found',
      });
    }

    // Find the item
    const itemIndex = cart.items.findIndex(
      (item) => item._id.toString() === itemId
    );

    if (itemIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Item not found in cart',
      });
    }

    // Remove the item
    cart.items.splice(itemIndex, 1);
    await cart.save();

    // Populate product details for response
    await cart.populate('items.product', 'name price images team slug');

    // Calculate totals
    const totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    const totalPrice = cart.items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    res.status(200).json({
      success: true,
      message: 'Item removed from cart',
      data: {
        _id: cart._id,
        user: cart.user,
        items: cart.items,
        totalItems,
        totalPrice: Math.round(totalPrice * 100) / 100,
        updatedAt: cart.updatedAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  addToCart,
  getCart,
  updateCartItem,
  removeCartItem,
};
