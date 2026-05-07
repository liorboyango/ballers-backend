/**
 * @deprecated Stripe webhook handler has been removed in favour of Rapyd.
 *
 * This module is a tombstone — any attempt to require it will throw
 * immediately so legacy imports surface loudly during dev and tests.
 *
 * The active webhook controller lives at src/controllers/rapydWebhookCtrl.js
 * and is mounted at POST /api/rapyd/webhook.
 */

'use strict';

throw new Error(
  '[REMOVED] src/controllers/stripeWebhookCtrl.js — Stripe webhooks have been ' +
    'replaced by Rapyd webhooks. Use require("./rapydWebhookCtrl") instead.'
);
