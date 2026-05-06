/**
 * User collection accessor (Firestore).
 * Documents shape:
 *   { name, email, password, role, isActive, createdAt, updatedAt }
 * Email uniqueness is enforced by query check at registration time.
 */
const { getDb } = require('../services/db');

const COLLECTION = 'users';

const collection = () => getDb().collection(COLLECTION);

const serialize = (snap) => {
  if (!snap || !snap.exists) return null;
  const data = snap.data();
  return {
    id: snap.id,
    name: data.name,
    email: data.email,
    role: data.role,
    isActive: data.isActive,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
};

const serializeWithPassword = (snap) => {
  if (!snap || !snap.exists) return null;
  return { id: snap.id, ...snap.data() };
};

module.exports = { COLLECTION, collection, serialize, serializeWithPassword };
