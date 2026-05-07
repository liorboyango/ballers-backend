/**
 * Stripe Webhook Routes
 *
 * IMPORTANT: The webhook endpoint uses express.raw() middleware to preserve
 * the raw request body required for Stripe signature verification.
 * This route must be registered in app.js BEFORE express.json() is applied
 * globally, or the raw body will be consumed and signature verification will fail.
 *
 * Routes:
 *   POST /api/stripe/webhook  - Receive Stripe webhook events
 */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { handleWebhook } = require('../../controllers/stripeWebhookCtrl');

const router = express.Router();

/**
 * Dedicated rate limiter for the webhook endpoint.
 * Stripe sends webhooks from a known set of IPs, but we apply a generous
 * limit to avoid blocking legitimate retries while still protecting against
 * abuse.
 *
 * 300 requests per minute is well above Stripe's normal delivery rate
 * even for high-volume stores.
 */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many webhook requests. Please try again later.',
  },
});

/**
 * @route   POST /api/stripe/webhook
 * @desc    Receive and process Stripe webhook events.
 *
 *          express.raw({ type: 'application/json' }) is applied here at the
 *          route level so that req.body is a raw Buffer — required by
 *          stripe.webhooks.constructEvent() for HMAC signature verification.
 *
 *          Do NOT add express.json() before this handler.
 *
 * @access  Public (Stripe servers — verified via HMAC signature in controller)
 */
router.post(
  '/webhook',
  webhookLimiter,
  express.raw({ type: 'application/json' }),
  handleWebhook
);

module.exports = router;
