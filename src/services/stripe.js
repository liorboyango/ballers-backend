/**
 * Stripe Service
 *
 * Initializes and exports a configured Stripe client instance.
 * Uses lazy initialization to avoid startup failures when
 * STRIPE_SECRET_KEY is not yet configured (e.g., during local dev
 * without payment features).
 *
 * Usage:
 *   const { getStripe } = require('./stripe');
 *   const stripe = getStripe();
 *   const paymentIntent = await stripe.paymentIntents.create({ ... });
 */

'use strict';

const logger = require('../utils/logger');

/** Cached Stripe instance (initialized on first use). */
let stripeInstance = null;

/**
 * Returns the initialized Stripe client.
 * Throws a clear error if STRIPE_SECRET_KEY is not set, so callers
 * receive an actionable message rather than a cryptic SDK error.
 *
 * @returns {import('stripe').Stripe} Configured Stripe client
 * @throws {Error} If STRIPE_SECRET_KEY environment variable is missing
 */
function getStripe() {
  if (stripeInstance) {
    return stripeInstance;
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    throw new Error(
      'STRIPE_SECRET_KEY environment variable is not set. ' +
        'Please add it to your .env file or deployment configuration.'
    );
  }

  // Validate key format: must start with sk_test_ or sk_live_
  if (!secretKey.startsWith('sk_test_') && !secretKey.startsWith('sk_live_')) {
    throw new Error(
      'STRIPE_SECRET_KEY appears to be invalid. ' +
        'It must start with "sk_test_" (test mode) or "sk_live_" (live mode).'
    );
  }

  const Stripe = require('stripe');

  stripeInstance = new Stripe(secretKey, {
    // Pin the API version for predictable behavior across Stripe releases.
    // Update this when intentionally adopting new Stripe API features.
    apiVersion: '2025-04-30.basil',
    // Identify this integration in Stripe dashboard logs.
    appInfo: {
      name: 'Ballers Store',
      version: '1.0.0',
    },
    // Automatically retry idempotent requests on network errors (up to 2 times).
    maxNetworkRetries: 2,
    // Timeout after 30 seconds to avoid hanging requests.
    timeout: 30000,
  });

  const mode = secretKey.startsWith('sk_live_') ? 'LIVE' : 'TEST';
  logger.info(`Stripe client initialized in ${mode} mode`);

  return stripeInstance;
}

/**
 * Resets the cached Stripe instance.
 * Useful in tests to force re-initialization with a different key.
 */
function resetStripe() {
  stripeInstance = null;
}

module.exports = { getStripe, resetStripe };
