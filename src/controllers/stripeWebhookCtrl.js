/**
 * @deprecated Stripe webhook handler has been removed in favour of Airwallex.
 *
 * This module is a tombstone — any attempt to require it will throw
 * immediately so legacy imports surface loudly during dev and tests.
 *
 * The active webhook controller lives at src/controllers/airwallexWebhookCtrl.js
 * and is mounted at POST /api/airwallex/webhook.
 */

'use strict';

throw new Error(
  '[REMOVED] src/controllers/stripeWebhookCtrl.js — Stripe webhooks have been ' +
    'replaced by Airwallex webhooks. Use require("./airwallexWebhookCtrl") instead.'
);
