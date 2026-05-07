/**
 * Order Routes
 * All order routes require authentication.
 *
 * POST /api/orders/create-payment-intent  - Create Stripe PaymentIntent from cart
 * POST /api/orders/create                 - Create order from cart
 * GET  /api/orders                        - Get user's order history
 * GET  /api/orders/:id                    - Get specific order
 */
const express = require('express');
const router = express.Router();
const orderCtrl = require('../../controllers/orderCtrl');
const { protect } = require('../../middleware/auth');
const { validate, schemas } = require('../../middleware/validation');

// All order routes require authentication
router.use(protect);

/**
 * @route   POST /api/orders/create-payment-intent
 * @desc    Fetch cart items, calculate total, create a Stripe PaymentIntent,
 *          and return the client_secret for the frontend to confirm payment.
 * @access  Protected
 *
 * Request body: {} (no body required — cart is fetched server-side)
 *
 * Response:
 * {
 *   status: 'success',
 *   data: {
 *     clientSecret: string,
 *     paymentIntentId: string,
 *     amount: number,        // in cents
 *     currency: string,      // 'usd'
 *     orderSummary: { items, subtotal, shippingCost, total, itemCount }
 *   }
 * }
 */
router.post('/create-payment-intent', orderCtrl.createPaymentIntent);

/**
 * @route   POST /api/orders/create
 * @desc    Create a new order from the user's cart
 * @access  Protected
 */
router.post('/create', validate(schemas.createOrder), orderCtrl.createOrder);

/**
 * @route   GET /api/orders
 * @desc    Get all orders for the authenticated user
 * @access  Protected
 */
router.get('/', validate(schemas.getOrdersQuery, 'query'), orderCtrl.getOrders);

/**
 * @route   GET /api/orders/:id
 * @desc    Get a specific order by ID
 * @access  Protected
 */
router.get('/:id', validate(schemas.objectIdParam, 'params'), orderCtrl.getOrderById);

module.exports = router;
