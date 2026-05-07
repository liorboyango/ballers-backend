/**
 * Rapyd Webhook Routes
 *
 * IMPORTANT: The webhook endpoint uses express.raw() middleware to preserve
 * the raw request body required for Rapyd HMAC signature verification.
 * This route MUST be registered in app.js BEFORE express.json() is applied
 * globally — otherwise the raw body will be consumed and signature
 * verification (rapyd.webhooks.constructEvent) will fail.
 *
 * Routes:
 *   POST /api/rapyd/webhook  - Receive Rapyd webhook events (payment.SUCCEEDED, payment.FAILED, ...)
 */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { handleWebhook } = require('../../controllers/rapydWebhookCtrl');

const router = express.Router();

/**
 * Dedicated rate limiter for the Rapyd webhook endpoint.
 *
 * Rapyd delivers webhooks from a known set of IPs and retries failed
 * deliveries with exponential backoff. 300 requests per minute is well
 * above the expected delivery rate even for high-volume stores while
 * still protecting the endpoint against abuse from spoofed traffic.
 *
 * Note: signature verification happens inside the controller, so any
 * unauthenticated traffic that gets past the limiter will still be
 * rejected with HTTP 400 before any business logic runs.
 */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many webhook requests. Please try again later.',
  },
});

/**
 * @route   POST /api/rapyd/webhook
 * @desc    Receive and process Rapyd webhook events.
 *
 *          express.raw({ type: 'application/json' }) is applied here at
 *          the route level so that req.body is a raw Buffer — required by
 *          rapyd.webhooks.constructEvent() for HMAC signature verification
 *          against the RAPYD_WEBHOOK_SECRET.
 *
 *          Do NOT add express.json() before this handler. The application
 *          factory (src/app.js) mounts this router prior to the global
 *          JSON body parser to ensure that ordering.
 *
 * @access  Public (Rapyd servers only — verified via HMAC signature in controller)
 */
router.post(
  '/webhook',
  webhookLimiter,
  express.raw({ type: 'application/json' }),
  handleWebhook
);

module.exports = router;
