/**
 * Rapyd Webhook Controller Tests
 *
 * Tests the POST /api/rapyd/webhook endpoint:
 * - Signature verification (valid, invalid, missing headers)
 * - PAYMENT_COMPLETED / payment.SUCCEEDED → 'paid', clear cart
 * - PAYMENT_FAILED / payment.FAILED       → 'payment_failed'
 * - Idempotency (order already in target status)
 * - Missing RAPYD_WEBHOOK_SECRET configuration
 * - Unhandled event types
 */

'use strict';

const request = require('supertest');

// ─── Mock dependencies BEFORE requiring app ─────────────────────────────────

// Mock rapyd service
const mockConstructEvent = jest.fn();
jest.mock('../src/services/rapyd', () => ({
  webhooks: {
    constructEvent: (...args) => mockConstructEvent(...args),
  },
  createPayment: jest.fn(),
  retrievePayment: jest.fn(),
}));

// Mock Firestore-related shared state
const mockOrderGet = jest.fn();
const mockOrderUpdate = jest.fn();
const mockCartGet = jest.fn();
const mockCartUpdate = jest.fn();

const mockOrderDocRef = { update: mockOrderUpdate };

const mockOrderDoc = {
  id: 'order-123',
  ref: mockOrderDocRef,
  data: jest.fn(() => ({
    user: 'user-abc',
    status: 'pending',
    rapydPaymentId: 'payment_test_123',
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

jest.mock('../src/services/db', () => ({
  getDb: jest.fn(() => ({
    collection: jest.fn(() => mockOrderQuery),
  })),
  admin: {
    firestore: {
      FieldValue: {
        serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP'),
      },
    },
  },
}));

jest.mock('../src/models/Order', () => ({
  collection: jest.fn(() => mockOrderQuery),
  serialize: jest.fn((snap) => ({ id: snap.id, ...snap.data() })),
  generateOrderNumber: jest.fn(() => 'BLR-TEST-001'),
  COLLECTION: 'orders',
}));

jest.mock('../src/models/Cart', () => ({
  docForUser: jest.fn(() => mockCartDocRef),
  collection: jest.fn(),
  serialize: jest.fn(),
  COLLECTION: 'carts',
}));

jest.mock('../src/utils/validateEnv', () => ({
  validateEnv: jest.fn(),
}));

// Avoid real firebase-admin work
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

// ─── Test Setup ─────────────────────────────────────────────────────────────

let app;

beforeAll(() => {
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
  process.env.RAPYD_ACCESS_KEY = 'rak_test_access_key';
  process.env.RAPYD_SECRET_KEY = 'rsk_test_secret_key';
  process.env.RAPYD_WEBHOOK_SECRET = 'rwh_test_webhook_secret';
  process.env.NODE_ENV = 'test';

  app = require('../src/app');
});

afterEach(() => {
  jest.clearAllMocks();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const buildPaymentEvent = (type, overrides = {}) => ({
  id: 'evt_test_001',
  type,
  data: {
    id: 'payment_test_123',
    status: 'CLO',
    amount: 99.99,
    currency: 'USD',
    metadata: { userId: 'user-abc' },
    ...overrides,
  },
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/rapyd/webhook', () => {
  describe('Signature verification', () => {
    it('returns 400 when the signature cannot be verified', async () => {
      mockConstructEvent.mockImplementation(() => {
        const AppError = require('../src/utils/AppError');
        throw new AppError('Webhook: invalid signature', 400);
      });

      const res = await request(app)
        .post('/api/rapyd/webhook')
        .set('Content-Type', 'application/json')
        .set('signature', 'invalid_sig')
        .set('salt', 'abc')
        .set('timestamp', String(Math.floor(Date.now() / 1000)))
        .set('access_key', 'rak_test_access_key')
        .send(JSON.stringify({ type: 'PAYMENT_COMPLETED' }));

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/signature/i);
    });

    it('returns 500 when RAPYD_WEBHOOK_SECRET is not configured', async () => {
      const original = process.env.RAPYD_WEBHOOK_SECRET;
      delete process.env.RAPYD_WEBHOOK_SECRET;

      const res = await request(app)
        .post('/api/rapyd/webhook')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ type: 'PAYMENT_COMPLETED' }));

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/webhook secret not configured/i);

      process.env.RAPYD_WEBHOOK_SECRET = original;
    });
  });

  describe('PAYMENT_COMPLETED / payment.SUCCEEDED', () => {
    beforeEach(() => {
      mockConstructEvent.mockReturnValue(buildPaymentEvent('PAYMENT_COMPLETED'));
    });

    it('returns 200 and updates order status to paid when order exists', async () => {
      mockOrderGet.mockResolvedValue({
        empty: false,
        docs: [mockOrderDoc],
      });
      mockOrderUpdate.mockResolvedValue({});
      mockCartGet.mockResolvedValue({ exists: true });
      mockCartUpdate.mockResolvedValue({});

      const res = await request(app)
        .post('/api/rapyd/webhook')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(buildPaymentEvent('PAYMENT_COMPLETED')));

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(mockOrderUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'paid' })
      );
      expect(mockCartUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ items: [] })
      );
    });

    it('skips order update when order is already paid (idempotency)', async () => {
      const alreadyPaidDoc = {
        id: 'order-123',
        ref: mockOrderDocRef,
        data: jest.fn(() => ({
          user: 'user-abc',
          status: 'paid',
          rapydPaymentId: 'payment_test_123',
        })),
      };

      mockOrderGet.mockResolvedValue({
        empty: false,
        docs: [alreadyPaidDoc],
      });

      const res = await request(app)
        .post('/api/rapyd/webhook')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(buildPaymentEvent('PAYMENT_COMPLETED')));

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(mockOrderUpdate).not.toHaveBeenCalled();
    });

    it('returns 200 when no order is found for the rapydPaymentId', async () => {
      mockOrderGet.mockResolvedValue({ empty: true, docs: [] });

      const res = await request(app)
        .post('/api/rapyd/webhook')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(buildPaymentEvent('PAYMENT_COMPLETED')));

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(mockOrderUpdate).not.toHaveBeenCalled();
    });

    it('does not call cart update when cart document does not exist', async () => {
      mockOrderGet.mockResolvedValue({
        empty: false,
        docs: [mockOrderDoc],
      });
      mockOrderUpdate.mockResolvedValue({});
      mockCartGet.mockResolvedValue({ exists: false });

      const res = await request(app)
        .post('/api/rapyd/webhook')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(buildPaymentEvent('PAYMENT_COMPLETED')));

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(mockCartUpdate).not.toHaveBeenCalled();
    });
  });

  describe('PAYMENT_FAILED / payment.FAILED', () => {
    it('returns 200 and updates order status to payment_failed', async () => {
      const event = buildPaymentEvent('PAYMENT_FAILED', {
        status: 'REJ',
        failure_message: 'Card declined',
      });
      mockConstructEvent.mockReturnValue(event);

      mockOrderGet.mockResolvedValue({
        empty: false,
        docs: [mockOrderDoc],
      });
      mockOrderUpdate.mockResolvedValue({});

      const res = await request(app)
        .post('/api/rapyd/webhook')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(event));

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(mockOrderUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'payment_failed' })
      );
    });

    it('returns 200 when no order is found for the failed payment', async () => {
      const event = buildPaymentEvent('PAYMENT_FAILED', { status: 'REJ' });
      mockConstructEvent.mockReturnValue(event);

      mockOrderGet.mockResolvedValue({ empty: true, docs: [] });

      const res = await request(app)
        .post('/api/rapyd/webhook')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(event));

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });
  });

  describe('Unhandled event types', () => {
    it('returns 200 for events the controller does not know about', async () => {
      const event = {
        id: 'evt_002',
        type: 'PAYOUT_COMPLETED',
        data: { id: 'payout_123' },
      };
      mockConstructEvent.mockReturnValue(event);

      const res = await request(app)
        .post('/api/rapyd/webhook')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(event));

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(mockOrderUpdate).not.toHaveBeenCalled();
    });
  });
});

// ─── Internal helpers (unit tests for the classifier) ───────────────────────

describe('rapydWebhookCtrl._internal.classifyEventType', () => {
  const { _internal } = require('../src/controllers/rapydWebhookCtrl');

  it('classifies success events', () => {
    expect(_internal.classifyEventType('PAYMENT_COMPLETED')).toBe('succeeded');
    expect(_internal.classifyEventType('payment.SUCCEEDED')).toBe('succeeded');
    expect(_internal.classifyEventType('PAYMENT_CAPTURED')).toBe('succeeded');
  });

  it('classifies failure events', () => {
    expect(_internal.classifyEventType('PAYMENT_FAILED')).toBe('failed');
    expect(_internal.classifyEventType('PAYMENT_DECLINED')).toBe('failed');
    expect(_internal.classifyEventType('PAYMENT_CANCELED')).toBe('failed');
    expect(_internal.classifyEventType('payment.FAILED')).toBe('failed');
  });

  it('classifies unknown events as unhandled', () => {
    expect(_internal.classifyEventType('PAYOUT_COMPLETED')).toBe('unhandled');
    expect(_internal.classifyEventType('')).toBe('unhandled');
    expect(_internal.classifyEventType(undefined)).toBe('unhandled');
  });
});
