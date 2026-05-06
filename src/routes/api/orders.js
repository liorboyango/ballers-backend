/**
 * Orders Router
 * All routes are protected – a valid JWT is required.
 *
 * POST /api/orders/create  – Place a new order from the user's cart
 * GET  /api/orders         – List the authenticated user's orders (paginated)
 * GET  /api/orders/:id     – Get a single order by ID
 */

const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { createOrder, getOrders, getOrderById } = require('../../controllers/orderCtrl');

/**
 * @route  POST /api/orders/create
 * @desc   Create a new order from the authenticated user's cart
 * @access Private (JWT required)
 *
 * Request body:
 * {
 *   shippingAddress: {
 *     firstName, lastName, email, address, city, zip, country, phone?
 *   },
 *   paymentInfo: {
 *     method: 'card' | 'paypal',
 *     cardNumber?,   // only last 4 digits are stored
 *     cardHolder?,
 *     expiryMonth?,
 *     expiryYear?
 *   }
 * }
 *
 * Response 201:
 * {
 *   message: 'Order placed successfully',
 *   order: { id, status, items, shippingAddress, paymentInfo, subtotal,
 *            shippingCost, taxAmount, totalAmount, createdAt }
 * }
 */
router.post('/create', auth, createOrder);

/**
 * @route  GET /api/orders
 * @desc   Get paginated order history for the authenticated user
 * @access Private (JWT required)
 *
 * Query params:
 *   page  {number} – page number (default: 1)
 *   limit {number} – items per page (default: 10, max: 50)
 *
 * Response 200:
 * {
 *   orders: [ { id, status, items, shippingAddress, paymentInfo,
 *               subtotal, shippingCost, taxAmount, totalAmount,
 *               createdAt, updatedAt } ],
 *   pagination: { total, page, limit, totalPages, hasNextPage, hasPrevPage }
 * }
 */
router.get('/', auth, getOrders);

/**
 * @route  GET /api/orders/:id
 * @desc   Get a single order by ID (must belong to the authenticated user)
 * @access Private (JWT required)
 *
 * Response 200:
 * {
 *   order: { id, status, items, shippingAddress, paymentInfo,
 *            subtotal, shippingCost, taxAmount, totalAmount,
 *            createdAt, updatedAt }
 * }
 */
router.get('/:id', auth, getOrderById);

module.exports = router;
