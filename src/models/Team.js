/**
 * Team collection accessor (Firestore).
 * Documents shape:
 *   { name, country, countryCode, group, flagUrl, confederation, createdAt, updatedAt }
 */
const { getDb } = require('../services/db');

const COLLECTION = 'teams';

const collection = () => getDb().collection(COLLECTION);

const serialize = (snap) => {
  if (!snap || !snap.exists) return null;
  return { id: snap.id, ...snap.data() };
};

module.exports = { COLLECTION, collection, serialize };
