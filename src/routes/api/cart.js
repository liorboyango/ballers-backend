/**
 * Cart Routes
 * All routes require authentication (JWT)
 *
 * POST   /api/cart/add     - Add item to cart
 * GET    /api/cart         - Get user's cart
 * PUT    /api/cart/update  - Update cart item (quantity/customization)
 * DELETE /api/cart/item    - Remove item from cart
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/auth');
const {
  addToCart,
  getCart,
  updateCartItem,
  removeCartItem,
} = require('../../controllers/cartCtrl');

/**
 * @route   POST /api/cart/add
 * @desc    Add a product to the user's cart
 * @access  Protected
 * @body    { productId: string, quantity?: number, customization?: { size?: string, number?: number, name?: string } }
 */
router.post('/add', protect, addToCart);

/**
 * @route   GET /api/cart
 * @desc    Get the authenticated user's cart with populated product details
 * @access  Protected
 */
router.get('/', protect, getCart);

/**
 * @route   PUT /api/cart/update
 * @desc    Update a cart item's quantity or customization
 * @access  Protected
 * @body    { itemId: string, quantity?: number, customization?: { size?: string, number?: number, name?: string } }
 */
router.put('/update', protect, updateCartItem);

/**
 * @route   DELETE /api/cart/item
 * @desc    Remove an item from the cart
 * @access  Protected
 * @body    { itemId: string }
 */
router.delete('/item', protect, removeCartItem);

module.exports = router;
