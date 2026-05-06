/**
 * Order collection accessor (Firestore).
 * Documents shape:
 *   { user, orderNumber, items, shippingAddress, paymentMethod, status,
 *     subtotal, shippingCost, total, notes, createdAt, updatedAt }
 *
 * `orderNumber` is generated in the controller before write
 * (Firestore has no per-save hooks).
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
