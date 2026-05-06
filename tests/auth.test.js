/**
 * Migration smoke test.
 *
 * The previous Mongo-backed integration suite no longer applies after the
 * Firestore migration. Until a Firestore emulator harness is wired up, this
 * file just verifies the data-access modules and credential parsing wire up
 * cleanly. It does not exercise real Firestore.
 */

jest.mock('firebase-admin', () => {
  const apps = [{ options: { projectId: 'test-project' } }];
  const firestoreFn = () => ({
    settings: () => {},
    collection: () => ({
      doc: () => ({}),
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
      limit: () => ({ get: async () => ({ empty: true, docs: [] }) }),
    }),
  });
  firestoreFn.FieldValue = {
    serverTimestamp: () => null,
    delete: () => null,
  };
  return {
    apps,
    initializeApp: () => apps[0],
    credential: {
      cert: () => ({}),
      applicationDefault: () => ({}),
    },
    firestore: firestoreFn,
    app: () => apps[0],
  };
});

process.env.FIREBASE_SERVICE_ACCOUNT =
  process.env.FIREBASE_SERVICE_ACCOUNT ||
  JSON.stringify({ project_id: 'test-project', client_email: 'test@test', private_key: 'test' });
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-test-secret-test-secret';

const connectDB = require('../src/services/db');

describe('firestore wiring', () => {
  it('connects with FIREBASE_SERVICE_ACCOUNT set', async () => {
    await expect(connectDB()).resolves.toBeUndefined();
  });

  it('exposes data-access modules without throwing', () => {
    expect(() => require('../src/models/User').collection()).not.toThrow();
    expect(() => require('../src/models/Product').collection()).not.toThrow();
    expect(() => require('../src/models/Team').collection()).not.toThrow();
    expect(() => require('../src/models/Cart').docForUser('uid')).not.toThrow();
    expect(() => require('../src/models/Order').collection()).not.toThrow();
  });

  it('generates an order number with the expected prefix', () => {
    const { generateOrderNumber } = require('../src/models/Order');
    expect(generateOrderNumber()).toMatch(/^BLR-/);
  });
});
