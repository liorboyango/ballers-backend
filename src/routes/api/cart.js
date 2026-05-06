/**
 * Cart Routes
 * All cart routes require authentication.
 * GET    /api/cart         - Get user's cart
 * POST   /api/cart/add     - Add item to cart
 * PUT    /api/cart/update  - Update item quantity
 * DELETE /api/cart/item    - Remove specific item
 * DELETE /api/cart         - Clear entire cart
 */
const express = require('express');
const router = express.Router();
const cartCtrl = require('../../controllers/cartCtrl');
const { protect } = require('../../middleware/auth');
const { validate, schemas } = require('../../middleware/validation');

// All cart routes require authentication
router.use(protect);

/**
 * @route   GET /api/cart
 * @desc    Get the current user's cart
 * @access  Protected
 */
router.get('/', cartCtrl.getCart);

/**
 * @route   POST /api/cart/add
 * @desc    Add a product to the cart
 * @access  Protected
 */
router.post('/add', validate(schemas.addToCart), cartCtrl.addToCart);

/**
 * @route   PUT /api/cart/update
 * @desc    Update quantity of a cart item
 * @access  Protected
 */
router.put('/update', validate(schemas.updateCart), cartCtrl.updateCartItem);

/**
 * @route   DELETE /api/cart/item
 * @desc    Remove a specific item from the cart
 * @access  Protected
 */
router.delete('/item', validate(schemas.removeCartItem, 'query'), cartCtrl.removeCartItem);

/**
 * @route   DELETE /api/cart
 * @desc    Clear all items from the cart
 * @access  Protected
 */
router.delete('/', cartCtrl.clearCart);

module.exports = router;
