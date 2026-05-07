/**
 * Stripe Service
 * Initializes and exports the Stripe SDK instance configured with the
 * STRIPE_SECRET_KEY environment variable.
 *
 * Usage:
 *   const stripe = require('./stripe');
 *   const paymentIntent = await stripe.paymentIntents.create({ ... });
 *
 * The Stripe SDK is initialized lazily (on first require) so that tests
 * can set process.env.STRIPE_SECRET_KEY before importing this module.
 */

'use strict';

const Stripe = require('stripe');

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error(
    'STRIPE_SECRET_KEY environment variable is not set. ' +
    'Add it to your .env file (sk_test_... for development, sk_live_... for production).'
  );
}

/**
 * Stripe client instance.
 * Configured with the secret key and a fixed API version for stability.
 */
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
  appInfo: {
    name: 'Ballers Store',
    version: '1.0.0',
  },
});

module.exports = stripe;
