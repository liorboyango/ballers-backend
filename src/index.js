/**
 * Ballers Backend - Main Entry Point
 * Express server with MongoDB connection, middleware stack, and API routes.
 * Security: helmet, CORS, rate-limiting, JWT auth, input validation.
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const connectDB = require('./services/db');
const logger = require('./utils/logger');
const { sanitizeInput } = require('./utils/sanitize');
const { errorHandler, notFoundHandler } = require('./middleware/error');
const { RATE_LIMIT } = require('./utils/constants');

// ─────────────────────────────────────────────
// ENVIRONMENT VALIDATION
// ─────────────────────────────────────────────
const REQUIRED_ENV_VARS = ['MONGO_URI', 'JWT_SECRET'];
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

// Set security HTTP headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow serving uploaded images
}));

// CORS configuration
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'https://ballers-app.onrender.com',
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
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

// Global rate limiter (100 requests per minute per IP)
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

// Stricter rate limiter for auth endpoints (10 requests per minute)
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

// HTTP request logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Parse JSON bodies (limit 10kb to prevent large payload attacks)
app.use(express.json({ limit: '10kb' }));

// Parse URL-encoded bodies
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Sanitize all incoming request data (XSS protection)
app.use(sanitizeInput);

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ─────────────────────────────────────────────
// API ROUTES
// ─────────────────────────────────────────────
app.use('/api/auth', require('./routes/api/auth'));
app.use('/api/teams', require('./routes/api/teams'));
app.use('/api/products', require('./routes/api/products'));
app.use('/api/cart', require('./routes/api/cart'));
app.use('/api/orders', require('./routes/api/orders'));

// Health check endpoint
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

// 404 handler for undefined routes
app.use(notFoundHandler);

// Global error handler
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

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection:', { reason, promise });
  // Graceful shutdown
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

startServer();

module.exports = app; // Export for testing
