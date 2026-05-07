/**
 * @deprecated Stripe integration has been removed in favour of Rapyd.
 *
 * This module is intentionally a tombstone: any code path that still
 * `require()`s it will throw immediately with a clear migration message,
 * which is much easier to debug than a silent no-op.
 *
 * Use `src/services/rapyd.js` instead. See the Rapyd migration plan in
 * the architecture design document.
 */

'use strict';

throw new Error(
  '[REMOVED] src/services/stripe.js — Stripe has been replaced by Rapyd. ' +
    'Use require("./rapyd") instead. See src/services/rapyd.js.'
);
