/**
 * Order Routes (all protected — require JWT)
 * POST /api/orders/create  - Create order from cart
 * GET  /api/orders         - Get user's order history
 * GET  /api/orders/:id     - Get single order by ID
 */

const express = require('express');
const router = express.Router();
const Joi = require('joi');

const { createOrder, getOrders, getOrderById } = require('../../controllers/orderCtrl');
const { protect } = require('../../middleware/auth');
const { validate } = require('../../middleware/validation');

// Validation schema for order creation
const createOrderSchema = Joi.object({
  shippingAddress: Joi.object({
    firstName: Joi.string().required(),
    lastName: Joi.string().required(),
    email: Joi.string().email().required(),
    street: Joi.string().required(),
    city: Joi.string().required(),
    state: Joi.string().allow(''),
    zip: Joi.string().required(),
    country: Joi.string().required(),
  }).required(),
  notes: Joi.string().max(500).allow(''),
});

// All order routes require authentication
router.use(protect);

router.post('/create', validate(createOrderSchema), createOrder);
router.get('/', getOrders);
router.get('/:id', getOrderById);

module.exports = router;
