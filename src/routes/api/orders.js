/**
 * Order Routes
 * All order routes require authentication.
 *
 * POST /api/orders/create-payment-intent  - Create Airwallex Payment Intent from cart, return clientSecret
 * POST /api/orders/create                 - Create order from cart (verifies Airwallex payment intent)
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
 * @desc    Fetch cart items, calculate the total, create an Airwallex Payment
 *          Intent, and return the clientSecret needed by Airwallex.js to
 *          render the secure card element and confirm the payment.
 * @access  Protected
 *
 * Request body: {} (no body required — cart is fetched server-side)
 *
 * Response:
 * {
 *   status: 'success',
 *   data: {
 *     paymentIntentId: string,    // Airwallex payment intent id (int_...)
 *     clientSecret: string|null,  // Secret Airwallex.js consumes
 *     amount: number,             // in minor units (cents)
 *     currency: string,           // 'USD'
 *     orderSummary: { items, subtotal, shippingCost, total, itemCount }
 *   }
 * }
 */
router.post('/create-payment-intent', orderCtrl.createPaymentIntent);

/**
 * @route   POST /api/orders/create-checkout-session
 * @desc    Hosted Checkout (redirect flow). Reads the cart, creates an Airwallex
 *          Payment Intent, pre-creates a pending order keyed by checkoutId, and
 *          returns a redirect URL to Airwallex's Hosted Payment Page.
 * @access  Protected
 *
 * Request body: { shippingAddress: { ..., zip }, notes? }
 * Response: { status: 'success', data: { checkoutId, redirectUrl } }
 */
router.post(
  '/create-checkout-session',
  validate(schemas.createCheckoutSession),
  orderCtrl.createCheckoutSession
);

/**
 * @route   POST /api/orders/finalize-checkout
 * @desc    Called after the user returns from the Hosted Payment Page. Verifies
 *          the payment with Airwallex and promotes the pending order to paid /
 *          payment_failed. Idempotent.
 * @access  Protected
 *
 * Request body: { checkoutId }
 * Response: { status: 'success', data: <Order> }
 */
router.post(
  '/finalize-checkout',
  validate(schemas.finalizeCheckout),
  orderCtrl.finalizeCheckout
);

/**
 * @route   POST /api/orders/create
 * @desc    Create a new order from the user's cart. Verifies the Airwallex
 *          Payment Intent (status, userId metadata, amount) before persisting
 *          the order.
 * @access  Protected
 *
 * Request body: { airwallexPaymentIntentId, shippingAddress, notes? }
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
