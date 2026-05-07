/**
 * Admin Authentication Middleware Tests
 *
 * Verifies that the `protect` + `restrictTo('admin')` middleware chain is
 * correctly applied to the new Yupoo admin endpoints:
 *
 *   GET  /api/admin/yupoo-categories
 *   POST /api/admin/crawl-products
 *
 * Test matrix:
 *   1. No token                 → 401 (Authentication required)
 *   2. Malformed Bearer token   → 401 (Invalid token)
 *   3. Expired JWT              → 401 (Session expired)
 *   4. Valid JWT, user deleted  → 401 (User no longer exists)
 *   5. Valid JWT, inactive user → 403 (Account deactivated)
 *   6. Valid JWT, role=customer → 403 (Access denied)
 *   7. Valid JWT, role=admin    → request proceeds to controller
 *
 * All tests are fully isolated — no real Firestore, no real Yupoo HTTP.
 */

'use strict';

// ─── Environment Setup ────────────────────────────────────────────────────────

process.env.JWT_SECRET = 'test-secret-32-chars-long-enough!!!';
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'test-project',
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: 'test-private-key',
});
process.env.NODE_ENV = 'test';

// ─── Module Mocks ────────────────────────────────────────────────────────────

/**
 * Mock firebase-admin so tests never need a real Firestore connection.
 * The mock is built so that we can control what the `doc().get()` resolves
 * to on a per-test basis via `__setMockUser`.
 */
const mockUser = {
  exists: true,
  id: 'admin-uid-1',
  data: () => ({
    id: 'admin-uid-1',
    name: 'Admin User',
    email: 'admin@ballers.com',
    role: 'admin',
    isActive: true,
  }),
};

let currentMockUser = { ...mockUser };

jest.mock('firebase-admin', () => {
  const firestoreFn = () => ({
    settings: () => {},
    collection: () => ({
      doc: () => ({
        get: async () => currentMockUser,
        set: async () => {},
      }),
      where: () => ({
        limit: () => ({
          get: async () => ({ empty: true, docs: [] }),
        }),
      }),
    }),
  });
  firestoreFn.FieldValue = {
    serverTimestamp: () => null,
    delete: () => null,
  };
  return {
    apps: [{ options: { projectId: 'test-project' } }],
    initializeApp: jest.fn(() => ({ options: { projectId: 'test-project' } })),
    credential: {
      cert: jest.fn(() => ({})),
      applicationDefault: jest.fn(() => ({})),
    },
    firestore: firestoreFn,
    app: jest.fn(() => ({ options: { projectId: 'test-project' } })),
  };
});

/**
 * Mock the yupooService so controllers don't perform real HTTP calls.
 */
jest.mock('../src/services/yupooService', () => ({
  getCategories: jest.fn().mockResolvedValue([]),
  getLastFetchedAt: jest.fn().mockReturnValue(new Date().toISOString()),
  crawlSelectedCategories: jest.fn().mockResolvedValue({
    created: 0,
    skipped: 0,
    errors: [],
    ids: [],
  }),
}));

/**
 * Mock the upload service so no GCS calls are made.
 */
jest.mock('../src/services/upload', () => ({
  upload: {
    single: () => (req, res, next) => next(),
  },
  uploadProductImageBuffer: jest.fn().mockResolvedValue('https://storage.example.com/test.jpg'),
  downloadAndUploadImages: jest.fn().mockResolvedValue([]),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/app');

// ─── Token Helpers ────────────────────────────────────────────────────────────

/**
 * Creates a signed JWT for use in Authorization headers.
 *
 * @param {object} payload - JWT payload (id, role, etc.)
 * @param {string|number} [expiresIn='1h'] - Token expiry
 * @returns {string} Signed JWT string
 */
const makeToken = (payload, expiresIn = '1h') =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });

/** Pre-built tokens reused across tests */
const adminToken = makeToken({ id: 'admin-uid-1', role: 'admin' });
const customerToken = makeToken({ id: 'customer-uid-1', role: 'customer' });
const expiredToken = makeToken({ id: 'admin-uid-1', role: 'admin' }, '-1s');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a minimal valid crawl-products body.
 */
const validCrawlBody = () => ({
  selectedCategories: [
    {
      id: '729135',
      name: 'Atlético Mineiro',
      path: '/categories/729135',
      isSubCate: true,
    },
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// SHARED BEHAVIOUR — Run the same auth test suite for both endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executes a request against the given endpoint using supertest.
 * GET  → agent.get(path)
 * POST → agent.post(path).send(body)
 */
const doRequest = (agent, method, path, body) => {
  if (method === 'GET') return agent.get(path);
  return agent.post(path).send(body);
};

/**
 * Shared authentication test suite.
 * Each endpoint that requires admin auth should be tested with this.
 *
 * @param {string}  method - 'GET' or 'POST'
 * @param {string}  path   - Route path, e.g. '/api/admin/yupoo-categories'
 * @param {Function} [body] - Factory returning a valid request body (POST only)
 */
const sharedAuthTests = (method, path, body) => {
  // ── 1. No token ────────────────────────────────────────────────────────
  it('returns 401 when no Authorization header is provided', async () => {
    const res = await doRequest(request(app), method, path, body && body());
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
    });
  });

  // ── 2. Malformed token ────────────────────────────────────────────────
  it('returns 401 for a malformed Bearer token', async () => {
    const res = await doRequest(request(app), method, path, body && body())
      .set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  // ── 3. Expired token ──────────────────────────────────────────────────
  it('returns 401 for an expired JWT', async () => {
    const res = await doRequest(request(app), method, path, body && body())
      .set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  // ── 4. User deleted ───────────────────────────────────────────────────
  it('returns 401 when the token user no longer exists in Firestore', async () => {
    currentMockUser = { exists: false };
    const res = await doRequest(request(app), method, path, body && body())
      .set('Authorization', `Bearer ${adminToken}`);
    currentMockUser = { ...mockUser }; // restore
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  // ── 5. Inactive account ───────────────────────────────────────────────
  it('returns 403 when the user account is deactivated', async () => {
    currentMockUser = {
      exists: true,
      id: 'admin-uid-1',
      data: () => ({
        id: 'admin-uid-1',
        name: 'Admin User',
        email: 'admin@ballers.com',
        role: 'admin',
        isActive: false,
      }),
    };
    const res = await doRequest(request(app), method, path, body && body())
      .set('Authorization', `Bearer ${adminToken}`);
    currentMockUser = { ...mockUser }; // restore
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // ── 6. Non-admin role ─────────────────────────────────────────────────
  it('returns 403 for a valid JWT with non-admin role (customer)', async () => {
    currentMockUser = {
      exists: true,
      id: 'customer-uid-1',
      data: () => ({
        id: 'customer-uid-1',
        name: 'Regular User',
        email: 'user@ballers.com',
        role: 'customer',
        isActive: true,
      }),
    };
    const res = await doRequest(request(app), method, path, body && body())
      .set('Authorization', `Bearer ${customerToken}`);
    currentMockUser = { ...mockUser }; // restore
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // ── 7. Valid admin token ───────────────────────────────────────────────
  it('allows requests through for a valid admin JWT', async () => {
    currentMockUser = { ...mockUser };
    const res = await doRequest(request(app), method, path, body && body())
      .set('Authorization', `Bearer ${adminToken}`);
    // The controller is mocked so it returns 200 with an empty result.
    // We only care that auth/authz did NOT block the request (no 401/403).
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
};

// ─── Test Suites ──────────────────────────────────────────────────────────────

describe('Admin Auth Middleware — GET /api/admin/yupoo-categories', () => {
  sharedAuthTests('GET', '/api/admin/yupoo-categories');
});

describe('Admin Auth Middleware — POST /api/admin/crawl-products', () => {
  sharedAuthTests('POST', '/api/admin/crawl-products', validCrawlBody);
});

// ─── Additional Edge Cases ────────────────────────────────────────────────────

describe('Admin Auth Middleware — edge cases', () => {
  it('rejects Authorization header without "Bearer " prefix', async () => {
    const res = await request(app)
      .get('/api/admin/yupoo-categories')
      .set('Authorization', adminToken); // missing 'Bearer ' prefix
    expect(res.status).toBe(401);
  });

  it('rejects empty Authorization header value', async () => {
    const res = await request(app)
      .get('/api/admin/yupoo-categories')
      .set('Authorization', '');
    expect(res.status).toBe(401);
  });

  it('rejects "Bearer " header with empty token', async () => {
    const res = await request(app)
      .get('/api/admin/yupoo-categories')
      .set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
  });

  it('rejects JWT signed with a different secret', async () => {
    const rogueToken = jwt.sign(
      { id: 'admin-uid-1', role: 'admin' },
      'completely-wrong-secret',
      { expiresIn: '1h' }
    );
    const res = await request(app)
      .get('/api/admin/yupoo-categories')
      .set('Authorization', `Bearer ${rogueToken}`);
    expect(res.status).toBe(401);
  });

  it('restrictTo blocks a manager role that is not admin', async () => {
    const managerToken = makeToken({ id: 'mgr-uid-1', role: 'manager' });
    currentMockUser = {
      exists: true,
      id: 'mgr-uid-1',
      data: () => ({
        id: 'mgr-uid-1',
        name: 'Manager User',
        email: 'mgr@ballers.com',
        role: 'manager',
        isActive: true,
      }),
    };
    const res = await request(app)
      .get('/api/admin/yupoo-categories')
      .set('Authorization', `Bearer ${managerToken}`);
    currentMockUser = { ...mockUser }; // restore
    expect(res.status).toBe(403);
  });

  it('error response always has success: false for auth failures', async () => {
    const res = await request(app)
      .post('/api/admin/crawl-products')
      .send(validCrawlBody());
    // No auth header
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('error');
    expect(typeof res.body.error).toBe('string');
  });
});
