/**
 * Order collection accessor (Firestore).
 *
 * Documents shape:
 * {
 *   user:            string,   // Firebase Auth UID of the order owner
 *   orderNumber:     string,   // Human-readable order number (e.g. BLR-XXXXXX-XXXX)
 *   items:           Array<{   // Snapshot of cart items at time of order
 *     product:       string,   // Product document id
 *     name:          string,   // Product name (snapshot)
 *     price:         number,   // Unit price at time of order
 *     quantity:      number,
 *     customization: object|null
 *   }>,
 *   shippingAddress: object,   // { firstName, lastName, email, address, city, postalCode, country, phone? }
 *   paymentMethod:   string,   // Always 'airwallex' for Airwallex-integrated orders
 *   airwallexPaymentIntentId: string, // Airwallex Payment Intent id (int_...) — used for webhook reconciliation
 *   status:          string,   // 'pending' | 'paid' | 'payment_failed' | 'processing' | 'shipped' | 'delivered' | 'cancelled'
 *   notes:           string,   // Optional order notes
 *   subtotal:        number,   // Sum of item prices
 *   shippingCost:    number,   // 0 if subtotal >= $100, else $9.99
 *   total:           number,   // subtotal + shippingCost
 *   airwallexEventId: string?, // Airwallex webhook event id from the last webhook that updated this order (audit)
 *   createdAt:       Timestamp,
 *   updatedAt:       Timestamp
 * }
 *
 * Status lifecycle:
 *   pending → paid             (via Airwallex webhook payment_intent.succeeded)
 *   pending → payment_failed   (via Airwallex webhook payment_intent.cancelled / payment_attempt.failed)
 *   paid → processing → shipped → delivered
 *   any → cancelled
 *
 * `orderNumber` is generated in the controller before write
 * (Firestore has no per-save hooks).
 *
 * `airwallexPaymentIntentId` should be indexed in Firestore to allow efficient
 * lookup by the webhook handler (findOrderByPaymentIntentId query) and by the
 * idempotency guard in createOrder.
 *
 * Migration note (Stripe / Rapyd → Airwallex):
 *   Legacy payment fields (`paymentIntentId`, `stripeEventId`, `rapydPaymentId`,
 *   `rapydEventId`, `paymentMethod: 'stripe' | 'rapyd'`) are no longer written by
 *   the controllers. Documents that pre-date the Airwallex cutover may still
 *   carry those fields; they are tolerated (Firestore is schemaless) but ignored
 *   by all current read paths and may be purged by a future backfill job.
 */
const { getDb } = require('../services/db');

const COLLECTION = 'orders';

const collection = () => getDb().collection(COLLECTION);

const serialize = (snap) => {
  if (!snap || !snap.exists) return null;
  return { id: snap.id, ...snap.data() };
};

const generateOrderNumber = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `BLR-${timestamp}-${random}`;
};

module.exports = { COLLECTION, collection, serialize, generateOrderNumber };
