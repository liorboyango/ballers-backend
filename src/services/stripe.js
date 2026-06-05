/**
 * @deprecated Stripe integration has been removed in favour of Airwallex.
 *
 * This module is intentionally a tombstone: any code path that still
 * `require()`s it will throw immediately with a clear migration message,
 * which is much easier to debug than a silent no-op.
 *
 * Use `src/services/airwallex.js` instead.
 */

'use strict';

throw new Error(
  '[REMOVED] src/services/stripe.js — Stripe has been replaced by Airwallex. ' +
    'Use require("./airwallex") instead. See src/services/airwallex.js.'
);
