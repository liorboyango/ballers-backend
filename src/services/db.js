/**
 * Firebase Firestore connection service.
 * Initializes firebase-admin once (idempotent) and exports the Firestore instance.
 *
 * Credentials come from FIREBASE_SERVICE_ACCOUNT, which holds the contents
 * of a service-account JSON key. The value may be either:
 *   - the raw JSON string, or
 *   - the same JSON, base64-encoded (handy for env-var-only hosts that don't
 *     tolerate the newlines in `private_key`).
 */
const admin = require('firebase-admin');
const logger = require('../utils/logger');

let firestore = null;

const parseServiceAccount = (raw) => {
  const trimmed = raw.trim();
  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  return (
    tryParse(trimmed) ||
    tryParse(Buffer.from(trimmed, 'base64').toString('utf8'))
  );
};

const connectDB = async () => {
  if (admin.apps.length === 0) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is not set.');
    }
    const serviceAccount = parseServiceAccount(raw);
    if (!serviceAccount || !serviceAccount.project_id) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT could not be parsed as JSON (raw or base64-encoded).'
      );
    }
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
      storageBucket:
        process.env.FIREBASE_STORAGE_BUCKET || `${serviceAccount.project_id}.appspot.com`,
    });
  }

  firestore = admin.firestore();
  firestore.settings({ ignoreUndefinedProperties: true });

  await firestore.collection('__healthcheck').limit(1).get();
  logger.info(`Firestore connected (project: ${admin.app().options.projectId || 'default'})`);
};

const getDb = () => {
  if (!firestore) {
    if (admin.apps.length === 0) {
      throw new Error('Firestore has not been initialized. Call connectDB() first.');
    }
    firestore = admin.firestore();
  }
  return firestore;
};

module.exports = connectDB;
module.exports.getDb = getDb;
module.exports.admin = admin;
