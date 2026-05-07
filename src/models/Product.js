/**
 * Product collection accessor (Firestore).
 * Documents shape:
 *   { name, description, price, team (team id string), kitType, sizes, stock,
 *     imageUrl,          // primary image URL (legacy single-image field)
 *     images,            // array of storage URLs (multi-image, from bulk import)
 *     customizable, sponsor, season, isNew, isFeatured,
 *     createdAt, updatedAt }
 *
 * Notes:
 *  - `imageUrl` is the original single-image field kept for backwards compat.
 *  - `images` is the new multi-image array added for Yupoo bulk import.
 *    When both fields exist, the first element of `images` is used as the
 *    primary display image.
 *  - Existing single-image products continue to work unchanged.
 */
const { getDb } = require('../services/db');

const COLLECTION = 'products';

const collection = () => getDb().collection(COLLECTION);

const serialize = (snap) => {
  if (!snap || !snap.exists) return null;
  return { id: snap.id, ...snap.data() };
};

module.exports = { COLLECTION, collection, serialize };
