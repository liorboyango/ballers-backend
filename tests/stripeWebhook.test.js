/**
 * Stripe Webhook Controller Tests
 *
 * Tests the POST /api/stripe/webhook endpoint:
 * - Signature verification (valid, invalid, missing)
 * - payment_intent.succeeded event handling
 * - payment_intent.payment_failed event handling
 * - Idempotency (duplicate events)
 * - Missing STRIPE_WEBHOOK_SECRET configuration
 */

'use strict';

const request = require('supertest');

// ─── Mock dependencies before requiring app ───────────────────────────────────

// Mock stripe service
const mockConstructEvent = jest.fn();
jest.mock('../src/services/stripe', () => ({
  webhooks: {
    constructEvent: mockConstructEvent,
  },
}));

// Mock Firestore db service
const mockOrderGet = jest.fn();
const mockOrderUpdate = jest.fn();
const mockCartGet = jest.fn();
const mockCartUpdate = jest.fn();

const mockOrderDocRef = {
  update: mockOrderUpdate,
};

const mockOrderDoc = {
  id: 'order-123',
  ref: mockOrderDocRef,
  data: jest.fn(() => ({
    user: 'user-abc',
    status: 'pending',
    paymentIntentId: 'pi_test_123',
  })),
};

const mockCartDocRef = {
  get: mockCartGet,
  update: mockCartUpdate,
};

const mockOrderQuery = {
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  get: mockOrderGet,
};

const mockDb = {
  collection: jest.fn(() => mockOrderQuery),
};

jest.mock('../src/services/db', () => ({
  getDb: jest.fn(() => mockDb),
  admin: {
    firestore: {
      FieldValue: {
        serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
      },
    },
  },
}));

// Mock Order model
jest.mock('../src/models/Order', () => ({
  collection: jest.fn(() => mockOrderQuery),
  serialize: jest.fn((snap) => ({ id: snap.id, ...snap.data() })),
  generateOrderNumber: jest.fn(() => 'BLR-TEST-001'),
  COLLECTION: 'orders',
}));

// Mock Cart model
jest.mock('../src/models/Cart', () => ({
  docForUser: jest.fn(() => mockCartDocRef),
  collection: jest.fn(),
  serialize: jest.fn(),
  COLLECTION: 'carts',
}));

// Mock validateEnv to avoid env var checks
jest.mock('../src/utils/validateEnv', () => ({
  validateEnv: jest.fn(),
}));

// ─── Test Setup ───────────────────────────────────────────────────────────────

let app;

beforeAll(() => {
  // Set required env vars before requiring app
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
    type: 'service_account',
    project_id: 'test-project',
    private_key_id: 'key-id',
    private_key: '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n',
    client_email: 'test@test-project.iam.gserviceaccount.com',
    client_id: '123456789',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
  });
  process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
  process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key_for_testing';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_webhook_secret';
  process.env.NODE_ENV = 'test';

  // Mock firebase-admin to avoid real connection
  jest.mock('firebase-admin', () => ({
    apps: [{ name: '[DEFAULT]' }],
    initializeApp: jest.fn(),
    credential: { cert: jest.fn() },
    firestore: Object.assign(
      jest.fn(() => ({
        settings: jest.fn(),
        collection: jest.fn(() => ({
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: [] }),
        })),
      })),
      {
        FieldValue: {
          serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
        },
      }
    ),
    app: jest.fn(() => ({ options: { projectId: 'test-project' } })),
  }));

  app = require('../src/app');
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Helper: build a fake Stripe event payload ────────────────────────────────

const buildPaymentIntentEvent = (type, overrides = {}) => ({
  id: 'evt_test_001',
  type,
  data: {
    object: {
      id: 'pi_test_123',
      metadata: { userId: 'user-abc' },
      last_payment_error: null,
      ...overrides,
    },
  },
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/stripe/webhook', () => {
  describe('Signature verification', () => {
    it('returns 400 when stripe-signature header is missing', async () => {
      const res = await request(app)
        .post('/api/stripe/webhook')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ type: 'payment_intent.succeeded' }));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/stripe-signature/i);
    });

    it('returns 400 when signature verification fails', async () => {
      mockConstructEvent.mockImplementation(() => {
        throw new Error('No signatures found matching the expected signature for payload');
      });

      const res = await request(app)
        .post('/api/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'invalid_sig')
        .send(JSON.stringify({ type: 'payment_intent.succeeded' }));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/signature verification failed/i);
    });

    it('returns 500 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
      const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.STRIPE_WEBHOOK_SECRET;

      const res = await request(app)
        .post('/api/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'some_sig')
        .send(JSON.stringify({ type: 'payment_intent.succeeded' }));

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/webhook secret not configured/i);

      process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
    });
  });

  describe('payment_intent.succeeded', () => {
    beforeEach(() => {
      const event = buildPaymentIntentEvent('payment_intent.succeeded');
      mockConstructEvent.mockReturnValue(event);
    });

    it('returns 200 and updates order status to paid when order exists', async () => {
      // Order found with status 'pending'
      mockOrderGet.mockResolvedValue({
        empty: false,
        docs: [mockOrderDoc],
      });
      mockOrderUpdate.mockResolvedValue({});

      // Cart exists
      mockCartGet.mockResolvedValue({ exists: true });
      mockCartUpdate.mockResolvedValue({});

      const res = await request(app)
        .post('/api/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'valid_sig')
        .send(JSON.stringify(buildPaymentIntentEvent('payment_intent.succeeded')));

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(mockOrderUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'paid' })
      );
      expect(mockCartUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ items: [] })
      );
    });

    it('returns 200 and skips update when order already has status paid (idempotency)', async () => {
      const alreadyPaidDoc = {
        id: 'order-123',
        ref: mockOrderDocRef,
        data: jest.fn(() => ({
          user: 'user-abc',
          status: 'paid', // already paid
          paymentIntentId: 'pi_test_123',
        })),
      };

      mockOrderGet.mockResolvedValue({
        empty: false,
        docs: [alreadyPaidDoc],
      });

      const res = await request(app)
        .post('/api/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'valid_sig')
        .send(JSON.stringify(buildPaymentIntentEvent('payment_intent.succeeded')));

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      // Should NOT call update since order is already paid
      expect(mockOrderUpdate).not.toHaveBeenCalled();
    });

    it('returns 200 when no order found for paymentIntentId', async () => {
      mockOrderGet.mockResolvedValue({ empty: true, docs: [] });

      const res = await request(app)
        .post('/api/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'valid_sig')
        .send(JSON.stringify(buildPaymentIntentEvent('payment_intent.succeeded')));

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(mockOrderUpdate).not.toHaveBeenCalled();
    });

    it('clears cart even when cart document does not exist', async () => {
      mockOrderGet.mockResolvedValue({
        empty: false,
        docs: [mockOrderDoc],
      });
      mockOrderUpdate.mockResolvedValue({});

      // Cart does not exist
      mockCartGet.mockResolvedValue({ exists: false });

      const res = await request(app)
        .post('/api/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'valid_sig')
        .send(JSON.stringify(buildPaymentIntentEvent('payment_intent.succeeded')));

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      // Cart update should NOT be called since cart doesn't exist
      expect(mockCartUpdate).not.toHaveBeenCalled();
    });
  });

  describe('payment_intent.payment_failed', () => {
    it('returns 200 and updates order status to payment_failed', async () => {
      const event = buildPaymentIntentEvent('payment_intent.payment_failed', {
        last_payment_error: { message: 'Your card was declined.' },
      });
      mockConstructEvent.mockReturnValue(event);

      mockOrderGet.mockResolvedValue({
        empty: false,
        docs: [mockOrderDoc],
      });
      mockOrderUpdate.mockResolvedValue({});

      const res = await request(app)
        .post('/api/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'valid_sig')
        .send(JSON.stringify(event));

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(mockOrderUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'payment_failed' })
      );
    });

    it('returns 200 when no order found for failed payment', async () => {
      const event = buildPaymentIntentEvent('payment_intent.payment_failed');
      mockConstructEvent.mockReturnValue(event);

      mockOrderGet.mockResolvedValue({ empty: true, docs: [] });

      const res = await request(app)
        .post('/api/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'valid_sig')
        .send(JSON.stringify(event));

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });
  });

  describe('Unhandled event types', () => {
    it('returns 200 for unhandled event types without error', async () => {
      const event = { id: 'evt_002', type: 'customer.created', data: { object: {} } };
      mockConstructEvent.mockReturnValue(event);

      const res = await request(app)
        .post('/api/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('stripe-signature', 'valid_sig')
        .send(JSON.stringify(event));

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });
  });
});
