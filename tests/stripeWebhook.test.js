/**
 * Stripe Webhook Controller — REMOVED
 *
 * This test file is a tombstone. The Stripe webhook handler was removed as
 * part of the Stripe → Rapyd migration (task 7/7). Equivalent tests for the
 * Rapyd webhook handler live in tests/rapydWebhook.test.js.
 *
 * The describe block below is intentionally skipped. It exists only so that
 * grep / blame trails leading here surface a clear migration message
 * instead of a missing-file 404. Once the migration has settled (and any
 * downstream documentation that still links to this file has been updated)
 * this file may be deleted entirely.
 */

'use strict';

describe.skip('Stripe webhook (REMOVED — see tests/rapydWebhook.test.js)', () => {
  it('Stripe integration was removed in the Rapyd cutover', () => {
    // No-op — see tests/rapydWebhook.test.js for the active webhook tests.
    expect(true).toBe(true);
  });
});
