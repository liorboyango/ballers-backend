/**
 * Order Routes
 * All order routes require authentication.
 *
 * POST /api/orders/create-payment-intent  - Create Rapyd Payment from cart, return clientToken
 * POST /api/orders/create                 - Create order from cart (verifies Rapyd payment)
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
 * @desc    Fetch cart items, calculate the total, create a Rapyd Payment,
 *          and return the clientToken needed by the Rapyd Client SDK to
 *          render the secure card iframe and confirm the payment.
 * @access  Protected
 *
 * Request body: {} (no body required — cart is fetched server-side)
 *
 * Response:
 * {
 *   status: 'success',
 *   data: {
 *     paymentId: string,         // Rapyd payment id (payment_...)
 *     clientToken: string|null,  // Token / URL the Rapyd Client SDK consumes
 *     amount: number,            // in minor units (cents) — parity with the
 *                                // legacy Stripe contract
 *     currency: string,          // 'USD'
 *     orderSummary: { items, subtotal, shippingCost, total, itemCount }
 *   }
 * }
 */
router.post('/create-payment-intent', orderCtrl.createPaymentIntent);

/**
 * @route   POST /api/orders/create
 * @desc    Create a new order from the user's cart. Verifies the Rapyd Payment
 *          (status, userId metadata, amount) before persisting the order.
 * @access  Protected
 *
 * Request body: { rapydPaymentId, shippingAddress, notes? }
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
