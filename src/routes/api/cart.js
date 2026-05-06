/**
 * Cart Routes (all protected — require JWT)
 * GET    /api/cart         - Get user's cart
 * POST   /api/cart/add     - Add item to cart
 * PUT    /api/cart/update  - Update item quantity
 * DELETE /api/cart/item    - Remove item from cart
 * DELETE /api/cart         - Clear entire cart
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');

const { getCart, addToCart, updateCartItem, removeCartItem, clearCart } = require('../../controllers/cartCtrl');
const { protect } = require('../../middleware/auth');
const { validate } = require('../../middleware/validation');

// Validation schemas
const addToCartSchema = Joi.object({
  productId: Joi.string().required(),
  quantity: Joi.number().integer().min(1).default(1),
  size: Joi.string().valid('XS', 'S', 'M', 'L', 'XL', 'XXL').required(),
  customization: Joi.object({
    number: Joi.string().max(2).allow('').default(''),
    name: Joi.string().max(20).allow('').default(''),
    sponsor: Joi.string().max(50).allow('').default(''),
  }).default({}),
});

const updateCartSchema = Joi.object({
  itemId: Joi.string().required(),
  quantity: Joi.number().integer().min(1).required(),
});

const removeCartSchema = Joi.object({
  itemId: Joi.string().required(),
});

// All cart routes require authentication
router.use(protect);

router.get('/', getCart);
router.post('/add', validate(addToCartSchema), addToCart);
router.put('/update', validate(updateCartSchema), updateCartItem);
router.delete('/item', validate(removeCartSchema), removeCartItem);
router.delete('/', clearCart);

module.exports = router;
