/**
 * Auth API Integration Tests
 * Tests for POST /api/auth/register and POST /api/auth/login
 *
 * Run with: npm test
 * Requires: MONGO_URI_TEST and JWT_SECRET env vars (or defaults)
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/index');
const User = require('../src/models/User');

// Use a separate test database
const TEST_DB = process.env.MONGO_URI_TEST || 'mongodb://localhost:27017/ballers_test';

beforeAll(async () => {
  // Disconnect from any existing connection and connect to test DB
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(TEST_DB);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  // Clean users collection before each test
  await User.deleteMany({});
});

// ─── Register Tests ───────────────────────────────────────────────────────────

describe('POST /api/auth/register', () => {
  const validUser = {
    name: 'Test User',
    email: 'test@example.com',
    password: 'SecurePass123',
  };

  it('should register a new user and return a JWT', async () => {
    const res = await request(app).post('/api/auth/register').send(validUser);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(validUser.email);
    expect(res.body.user.password).toBeUndefined(); // Password must not be returned
  });

  it('should hash the password in the database', async () => {
    await request(app).post('/api/auth/register').send(validUser);

    const dbUser = await User.findOne({ email: validUser.email }).select('+password');
    expect(dbUser).toBeTruthy();
    expect(dbUser.password).not.toBe(validUser.password);
    expect(dbUser.password).toMatch(/^\$2[ab]\$/); // bcrypt hash prefix
  });

  it('should return 409 if email already exists', async () => {
    await request(app).post('/api/auth/register').send(validUser);
    const res = await request(app).post('/api/auth/register').send(validUser);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('should return 400 if name is missing', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: validUser.email, password: validUser.password });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.details).toBeDefined();
  });

  it('should return 400 if email is invalid', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validUser, email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 400 if password is too short', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ ...validUser, password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should assign default role of "user"', async () => {
    const res = await request(app).post('/api/auth/register').send(validUser);

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('user');
  });
});

// ─── Login Tests ──────────────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  const credentials = {
    name: 'Login User',
    email: 'login@example.com',
    password: 'SecurePass123',
  };

  beforeEach(async () => {
    // Pre-create a user for login tests
    await request(app).post('/api/auth/register').send(credentials);
  });

  it('should login with valid credentials and return a JWT', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: credentials.password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe(credentials.email);
    expect(res.body.user.password).toBeUndefined();
  });

  it('should return 401 for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: 'WrongPassword!' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should return 401 for non-existent email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: credentials.password });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should return 400 if email is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: credentials.password });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should return 400 if password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('should not reveal whether email exists (same error for wrong email/password)', async () => {
    const wrongEmailRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: credentials.password });

    const wrongPasswordRes = await request(app)
      .post('/api/auth/login')
      .send({ email: credentials.email, password: 'WrongPassword!' });

    // Both should return the same generic error message
    expect(wrongEmailRes.body.error).toBe(wrongPasswordRes.body.error);
  });
});

// ─── GET /api/auth/me Tests ───────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  let token;
  const user = {
    name: 'Me User',
    email: 'me@example.com',
    password: 'SecurePass123',
  };

  beforeEach(async () => {
    const res = await request(app).post('/api/auth/register').send(user);
    token = res.body.token;
  });

  it('should return the current user profile with a valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe(user.email);
    expect(res.body.user.password).toBeUndefined();
  });

  it('should return 401 without a token', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('should return 401 with an invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalidtoken123');

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
