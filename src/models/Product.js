/**
 * Product collection accessor (Firestore).
 * Documents shape:
 *   { name, description, price, team (team id string), kitType, sizes, stock,
 *     imageUrl, customizable, sponsor, season, isNew, isFeatured,
 *     createdAt, updatedAt }
 */
const { getDb } = require('../services/db');

const COLLECTION = 'products';

const collection = () => getDb().collection(COLLECTION);

const serialize = (snap) => {
  if (!snap || !snap.exists) return null;
  return { id: snap.id, ...snap.data() };
};

module.exports = { COLLECTION, collection, serialize };
