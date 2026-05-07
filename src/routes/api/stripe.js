/**
 * @deprecated Stripe webhook router has been removed in favour of Rapyd.
 *
 * The legacy POST /api/stripe/webhook endpoint is no longer mounted in
 * src/app.js. This file remains as a tombstone so that any direct
 * require() from older code surfaces a clear error rather than silently
 * loading an empty router.
 *
 * The active webhook router is src/routes/api/rapyd.js and is mounted at
 * /api/rapyd in src/app.js.
 */

'use strict';

throw new Error(
  '[REMOVED] src/routes/api/stripe.js — Stripe webhook route has been removed. ' +
    'Use require("./rapyd") and mount at /api/rapyd instead.'
);
