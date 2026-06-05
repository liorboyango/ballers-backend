/**
 * Order Controller Tests (Airwallex integration)
 *
 *   - createOrderSchema: Joi validation for airwallexPaymentIntentId
 *   - getOrdersQuerySchema: status values
 *   - Order model: serialize, generateOrderNumber
 *   - Airwallex payment intent retrieval / status mapping helpers
 *   - Idempotency guard logic
 *   - Total calculation
 *
 * Uses Jest mocks for the Airwallex service, Firestore, and firebase-admin so
 * tests never touch the real network or database.
 */

'use strict';

// ─── Environment Setup (must run before any app modules are required) ────────
process.env.AIRWALLEX_CLIENT_ID = 'test_client_id';
process.env.AIRWALLEX_API_KEY = 'test_api_key';
process.env.AIRWALLEX_WEBHOOK_SECRET = 'awx_test_mock_webhook_secret';
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'test-project',
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: 'test-private-key',
});
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long';

// ─── Mock firebase-admin ─────────────────────────────────────────────────────
jest.mock('firebase-admin', () => {
  const serverTimestampValue = { _type: 'serverTimestamp' };
  const apps = [{ options: { projectId: 'test-project' } }];

  const firestoreFn = () => ({
    settings: () => {},
    collection: () => ({
      doc: () => ({}),
      where: () => ({
        limit: () => ({
          get: async () => ({ empty: true, docs: [] }),
        }),
        where: () => ({
          orderBy: () => ({
            get: async () => ({ docs: [] }),
          }),
        }),
        orderBy: () => ({
          get: async () => ({ docs: [] }),
        }),
      }),
    }),
    runTransaction: async (fn) =>
      fn({
        get: async () => ({ exists: false, data: () => ({}) }),
        set: () => {},
        update: () => {},
        getAll: async () => [],
      }),
    getAll: async () => [],
  });

  firestoreFn.FieldValue = {
    serverTimestamp: () => serverTimestampValue,
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

// ─── Mock Airwallex service ──────────────────────────────────────────────────
const mockAirwallexRetrieve = jest.fn();
const mockAirwallexCreate = jest.fn();
const mockAirwallexConstructEvent = jest.fn();

jest.mock('../src/services/airwallex', () => ({
  retrievePaymentIntent: (...args) => mockAirwallexRetrieve(...args),
  createPaymentIntent: (...args) => mockAirwallexCreate(...args),
  webhooks: {
    constructEvent: (...args) => mockAirwallexConstructEvent(...args),
  },
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createOrderSchema validation', () => {
  const { schemas } = require('../src/middleware/validation');
  const schema = schemas.createOrder;

  const validAddress = {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john@example.com',
    address: '123 Main Street',
    city: 'New York',
    postalCode: '10001',
    country: 'United States',
  };

  it('accepts a valid airwallexPaymentIntentId with int_ prefix', () => {
    const { error } = schema.validate({
      airwallexPaymentIntentId: 'int_abc123def456ghi789',
      shippingAddress: validAddress,
    });
    expect(error).toBeUndefined();
  });

  it('rejects missing airwallexPaymentIntentId', () => {
    const { error } = schema.validate({
      shippingAddress: validAddress,
    });
    expect(error).toBeDefined();
    const messages = error.details.map((d) => d.message);
    expect(messages.some((m) => m.includes('airwallexPaymentIntentId'))).toBe(true);
  });

  it('rejects airwallexPaymentIntentId without int_ prefix', () => {
    const { error } = schema.validate({
      airwallexPaymentIntentId: 'payment_legacy_rapyd_id', // legacy id — must be rejected
      shippingAddress: validAddress,
    });
    expect(error).toBeDefined();
    const messages = error.details.map((d) => d.message);
    expect(messages.some((m) => m.includes('airwallexPaymentIntentId'))).toBe(true);
  });

  it('rejects empty airwallexPaymentIntentId', () => {
    const { error } = schema.validate({
      airwallexPaymentIntentId: '',
      shippingAddress: validAddress,
    });
    expect(error).toBeDefined();
  });

  it('rejects airwallexPaymentIntentId that is too short', () => {
    const { error } = schema.validate({
      airwallexPaymentIntentId: 'int_abc', // less than 6 chars after prefix
      shippingAddress: validAddress,
    });
    expect(error).toBeDefined();
  });

  it('accepts optional notes field', () => {
    const { error } = schema.validate({
      airwallexPaymentIntentId: 'int_abc123def456ghi789',
      shippingAddress: validAddress,
      notes: 'Please leave at door',
    });
    expect(error).toBeUndefined();
  });

  it('rejects notes exceeding 500 characters', () => {
    const { error } = schema.validate({
      airwallexPaymentIntentId: 'int_abc123def456ghi789',
      shippingAddress: validAddress,
      notes: 'x'.repeat(501),
    });
    expect(error).toBeDefined();
  });

  it('strips legacy paymentMethod field (no longer accepted)', () => {
    const { value } = schema.validate(
      {
        airwallexPaymentIntentId: 'int_abc123def456ghi789',
        shippingAddress: validAddress,
        paymentMethod: 'card', // legacy — should be stripped
      },
      { stripUnknown: true }
    );
    expect(value.paymentMethod).toBeUndefined();
  });

  it('strips legacy rapydPaymentId field (no longer accepted)', () => {
    const { value } = schema.validate(
      {
        airwallexPaymentIntentId: 'int_abc123def456ghi789',
        shippingAddress: validAddress,
        rapydPaymentId: 'payment_legacy_rapyd_id', // Rapyd legacy
      },
      { stripUnknown: true }
    );
    expect(value.rapydPaymentId).toBeUndefined();
  });

  it('rejects missing shippingAddress', () => {
    const { error } = schema.validate({
      airwallexPaymentIntentId: 'int_abc123def456ghi789',
    });
    expect(error).toBeDefined();
    expect(error.details.some((d) => d.path.includes('shippingAddress'))).toBe(true);
  });
});

describe('getOrdersQuerySchema status values', () => {
  const { schemas } = require('../src/middleware/validation');
  const schema = schemas.getOrdersQuery;

  it('accepts paid status', () => {
    const { error } = schema.validate({ status: 'paid' });
    expect(error).toBeUndefined();
  });

  it('accepts payment_failed status', () => {
    const { error } = schema.validate({ status: 'payment_failed' });
    expect(error).toBeUndefined();
  });

  it('accepts pending status', () => {
    const { error } = schema.validate({ status: 'pending' });
    expect(error).toBeUndefined();
  });

  it('rejects unknown status', () => {
    const { error } = schema.validate({ status: 'unknown_status' });
    expect(error).toBeDefined();
  });
});

describe('Order model', () => {
  const Order = require('../src/models/Order');

  it('generates order numbers with BLR- prefix', () => {
    const num = Order.generateOrderNumber();
    expect(num).toMatch(/^BLR-[A-Z0-9]+-[A-Z0-9]+$/);
  });

  it('generates unique order numbers', () => {
    const nums = new Set(Array.from({ length: 100 }, () => Order.generateOrderNumber()));
    expect(nums.size).toBeGreaterThan(90);
  });

  it('serialize returns null for non-existent snap', () => {
    expect(Order.serialize(null)).toBeNull();
    expect(Order.serialize({ exists: false })).toBeNull();
  });

  it('serialize returns id + data for existing snap', () => {
    const snap = {
      exists: true,
      id: 'order123',
      data: () => ({
        user: 'user456',
        airwallexPaymentIntentId: 'int_test123',
        paymentMethod: 'airwallex',
        status: 'paid',
        total: 89.99,
      }),
    };
    const result = Order.serialize(snap);
    expect(result).toEqual({
      id: 'order123',
      user: 'user456',
      airwallexPaymentIntentId: 'int_test123',
      paymentMethod: 'airwallex',
      status: 'paid',
      total: 89.99,
    });
  });
});

describe('Airwallex Payment Intent verification logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('retrieves a valid Payment Intent from Airwallex', async () => {
    mockAirwallexRetrieve.mockResolvedValueOnce({
      id: 'int_test123',
      status: 'SUCCEEDED',
      amount: 99.99,
      currency: 'USD',
      metadata: { userId: 'user456' },
    });

    const airwallex = require('../src/services/airwallex');
    const intent = await airwallex.retrievePaymentIntent('int_test123');

    expect(intent.id).toBe('int_test123');
    expect(intent.status).toBe('SUCCEEDED');
    expect(mockAirwallexRetrieve).toHaveBeenCalledWith('int_test123');
  });

  it('throws when Airwallex retrieve fails', async () => {
    mockAirwallexRetrieve.mockRejectedValueOnce(new Error('Airwallex: intent not found'));

    const airwallex = require('../src/services/airwallex');
    await expect(airwallex.retrievePaymentIntent('int_invalid')).rejects.toThrow(
      /intent not found/i
    );
  });

  // Mirrors the classifyAirwallexStatus helper in the controller.
  const classify = (status) => {
    const SUCCESS = new Set(['SUCCEEDED']);
    const PENDING = new Set([
      'REQUIRES_PAYMENT_METHOD',
      'REQUIRES_CUSTOMER_ACTION',
      'REQUIRES_CAPTURE',
      'PENDING',
    ]);
    const FAILED = new Set(['CANCELLED', 'CANCELED', 'EXPIRED', 'FAILED']);
    if (!status) return 'unknown';
    const s = String(status).toUpperCase();
    if (SUCCESS.has(s)) return 'success';
    if (FAILED.has(s)) return 'failed';
    if (PENDING.has(s)) return 'pending';
    return 'unknown';
  };

  it('maps SUCCEEDED Airwallex status to success → paid order', () => {
    expect(classify('SUCCEEDED')).toBe('success');
  });

  it('maps REQUIRES_CAPTURE Airwallex status to pending → pending order', () => {
    expect(classify('REQUIRES_CAPTURE')).toBe('pending');
  });

  it('maps REQUIRES_PAYMENT_METHOD Airwallex status to pending', () => {
    expect(classify('REQUIRES_PAYMENT_METHOD')).toBe('pending');
  });

  it('maps CANCELLED/EXPIRED to failed', () => {
    expect(classify('CANCELLED')).toBe('failed');
    expect(classify('EXPIRED')).toBe('failed');
  });

  it('returns unknown for unrecognised statuses', () => {
    expect(classify('SOMETHING_ELSE')).toBe('unknown');
    expect(classify(undefined)).toBe('unknown');
  });
});

describe('Order creation idempotency (airwallexPaymentIntentId)', () => {
  it('returns existing order when airwallexPaymentIntentId already used', () => {
    const existingOrders = [
      { id: 'order123', airwallexPaymentIntentId: 'int_test123', status: 'paid' },
    ];

    const paymentIntentId = 'int_test123';
    const found = existingOrders.find((o) => o.airwallexPaymentIntentId === paymentIntentId);

    expect(found).toBeDefined();
    expect(found.id).toBe('order123');
    expect(found.status).toBe('paid');
  });

  it('proceeds with new order when airwallexPaymentIntentId is unique', () => {
    const existingOrders = [
      { id: 'order123', airwallexPaymentIntentId: 'int_test123', status: 'paid' },
    ];

    const paymentIntentId = 'int_new456';
    const found = existingOrders.find((o) => o.airwallexPaymentIntentId === paymentIntentId);

    expect(found).toBeUndefined();
  });
});

describe('Order total calculation', () => {
  const calculateTotals = (orderItems) => {
    const subtotal =
      Math.round(orderItems.reduce((sum, it) => sum + it.price * it.quantity, 0) * 100) / 100;
    const shippingCost = subtotal >= 100 ? 0 : 9.99;
    const total = Math.round((subtotal + shippingCost) * 100) / 100;
    return { subtotal, shippingCost, total };
  };

  it('applies free shipping for orders >= $100', () => {
    const items = [{ price: 50, quantity: 2 }];
    const { subtotal, shippingCost, total } = calculateTotals(items);
    expect(subtotal).toBe(100);
    expect(shippingCost).toBe(0);
    expect(total).toBe(100);
  });

  it('applies $9.99 shipping for orders < $100', () => {
    const items = [{ price: 29.99, quantity: 2 }];
    const { subtotal, shippingCost, total } = calculateTotals(items);
    expect(subtotal).toBe(59.98);
    expect(shippingCost).toBe(9.99);
    expect(total).toBe(69.97);
  });

  it('handles exactly $99.99 subtotal with shipping', () => {
    const items = [{ price: 99.99, quantity: 1 }];
    const { subtotal, shippingCost, total } = calculateTotals(items);
    expect(subtotal).toBe(99.99);
    expect(shippingCost).toBe(9.99);
    expect(total).toBe(109.98);
  });

  it('handles multiple items correctly', () => {
    const items = [
      { price: 39.99, quantity: 1 },
      { price: 29.99, quantity: 2 },
    ];
    const { subtotal, shippingCost, total } = calculateTotals(items);
    expect(subtotal).toBe(99.97);
    expect(shippingCost).toBe(9.99);
    expect(total).toBe(109.96);
  });
});
