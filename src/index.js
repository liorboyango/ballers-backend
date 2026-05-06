/**
 * Ballers Backend - Main Entry Point
 * Express server with Firestore connection, middleware stack, and API routes.
 * Security: helmet, CORS, rate-limiting, JWT auth, input validation.
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const connectDB = require('./services/db');
const logger = require('./utils/logger');
const { sanitizeInput } = require('./utils/sanitize');
const { errorHandler, notFoundHandler } = require('./middleware/error');
const { RATE_LIMIT } = require('./utils/constants');

// ─────────────────────────────────────────────
// ENVIRONMENT VALIDATION
// ─────────────────────────────────────────────
const REQUIRED_ENV_VARS = ['FIREBASE_SERVICE_ACCOUNT', 'JWT_SECRET'];
const missingVars = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
if (missingVars.length > 0) {
  logger.error(`Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

// ─────────────────────────────────────────────
// APP INITIALIZATION
// ─────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 5000;

// ─────────────────────────────────────────────
// SECURITY MIDDLEWARE
// ─────────────────────────────────────────────

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'https://ballers-app.onrender.com',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS policy: Origin ${origin} is not allowed.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const globalLimiter = rateLimit({
  windowMs: RATE_LIMIT.WINDOW_MS,
  max: RATE_LIMIT.MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'fail',
    message: 'Too many requests from this IP. Please try again in a minute.',
  },
});

const authLimiter = rateLimit({
  windowMs: RATE_LIMIT.WINDOW_MS,
  max: RATE_LIMIT.AUTH_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'fail',
    message: 'Too many authentication attempts. Please try again in a minute.',
  },
});

app.use('/api/', globalLimiter);
app.use('/api/auth/', authLimiter);

// ─────────────────────────────────────────────
// GENERAL MIDDLEWARE
// ─────────────────────────────────────────────

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(sanitizeInput);

// ─────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────
app.use('/api/auth', require('./routes/api/auth'));
app.use('/api/teams', require('./routes/api/teams'));
app.use('/api/products', require('./routes/api/products'));
app.use('/api/cart', require('./routes/api/cart'));
app.use('/api/orders', require('./routes/api/orders'));

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'ballers-backend',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ─────────────────────────────────────────────
// ERROR HANDLING (must be LAST)
// ─────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─────────────────────────────────────────────
// DATABASE CONNECTION & SERVER START
// ─────────────────────────────────────────────
const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      logger.info(`Ballers backend running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection:', { reason, promise });
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

startServer();

module.exports = app;
