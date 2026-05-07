/**
 * Ballers Backend - Express Application Factory
 *
 * Creates and configures the Express app with all middleware
 * and route registrations. Exported separately from index.js
 * to allow clean testing without starting the HTTP server.
 *
 * IMPORTANT — Webhook route ordering:
 * The /api/rapyd/webhook route is registered BEFORE the global
 * express.json() middleware so that the raw request body is preserved
 * for HMAC signature verification. Registering it after express.json()
 * would cause rapyd.webhooks.constructEvent() to throw a signature
 * mismatch error.
 *
 * Migration note: the legacy /api/stripe webhook route has been removed
 * as part of the Stripe → Rapyd cutover. Any in-flight Stripe deliveries
 * will receive a 404 and Stripe-side retries will eventually drop them.
 */

'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { errorHandler, notFoundHandler } = require('./middleware/error');
const logger = require('./utils/logger');
const { RATE_LIMIT } = require('./utils/constants');

const app = express();

// ─── Security Middleware ─────────────────────────────────────────────────────

/**
 * Helmet sets various HTTP headers to protect against common web vulnerabilities.
 * Configured to allow serving static files and cross-origin image loading.
 */
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow cross-origin image loading
  })
);

/**
 * CORS configuration.
 * In production, only the configured FRONTEND_URL is allowed.
 * In development, localhost:3000 is also permitted.
 */
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      logger.warn(`CORS blocked request from origin: ${origin}`);
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ─── Rate Limiting ───────────────────────────────────────────────────────────

/**
 * Global rate limiter: 100 requests per minute per IP.
 * Stricter limits are applied per-route for auth endpoints.
 */
const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT.WINDOW_MS,
  max: RATE_LIMIT.MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later.',
  },
  handler: (req, res, next, options) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(options.statusCode).json(options.message);
  },
});

app.use(globalLimiter);

// ─── Webhook Routes (MUST be before express.json()) ──────────────────────────

/**
 * Register Rapyd webhook routes BEFORE the global JSON body parser.
 *
 * Rapyd signature verification requires the raw, unparsed request body as a
 * Buffer. If express.json() runs first, it consumes the stream and replaces
 * req.body with a parsed object, which causes
 * rapyd.webhooks.constructEvent() to throw a signature mismatch error.
 *
 * The route module applies express.raw({ type: 'application/json' })
 * internally so that req.body is a Buffer only for the webhook endpoint.
 */
app.use('/api/rapyd', require('./routes/api/rapyd'));

// ─── Request Parsing ─────────────────────────────────────────────────────────

/** Parse incoming JSON payloads (max 10mb for base64 image previews) */
app.use(express.json({ limit: '10mb' }));

/** Parse URL-encoded form data */
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Compression ─────────────────────────────────────────────────────────────

/** Gzip/Brotli compress all responses */
app.use(compression());

// ─── HTTP Request Logging ────────────────────────────────────────────────────

/**
 * Morgan HTTP request logger.
 * Uses 'combined' format in production for full log entries,
 * 'dev' format in development for concise colored output.
 * Streams to Winston logger.
 */
app.use(
  morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev', {
    stream: {
      write: (message) => logger.http(message.trim()),
    },
    skip: (req) => req.url === '/health', // Skip health check logs
  })
);

// ─── Health Check ────────────────────────────────────────────────────────────

/**
 * @route   GET /health
 * @desc    Health check endpoint for load balancers and monitoring
 * @access  Public
 */
app.get('/health', (req, res) => {
  const admin = require('firebase-admin');
  const database = admin.apps.length > 0 ? 'connected' : 'disconnected';

  res.status(200).json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database,
    uptime: process.uptime(),
  });
});

// ─── API Routes ──────────────────────────────────────────────────────────────

/**
 * Mount all API route modules under /api prefix.
 * Routes are registered here; implementations live in src/routes/api/.
 */
app.use('/api/auth', require('./routes/api/auth'));
app.use('/api/teams', require('./routes/api/teams'));
app.use('/api/products', require('./routes/api/products'));
app.use('/api/cart', require('./routes/api/cart'));
app.use('/api/orders', require('./routes/api/orders'));
app.use('/api/upload', require('./routes/api/upload'));

// ─── Error Handling ──────────────────────────────────────────────────────────

/** 404 handler for unmatched routes */
app.use(notFoundHandler);

/** Centralized error handler - must be last middleware */
app.use(errorHandler);

module.exports = app;
