/**
 * Ballers Backend - Main Entry Point
 * Express server with middleware stack, route registration, and database connection.
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
const errorHandler = require('./middleware/error');

// Route imports
const authRoutes = require('./routes/api/auth');
const productRoutes = require('./routes/api/products');
const teamRoutes = require('./routes/api/teams');
const cartRoutes = require('./routes/api/cart');
const orderRoutes = require('./routes/api/orders');
const uploadRoutes = require('./routes/api/upload');

// Validate required environment variables
const requiredEnvVars = ['MONGO_URI', 'JWT_SECRET'];
const missingEnvVars = requiredEnvVars.filter((v) => !process.env[v]);
if (missingEnvVars.length > 0) {
  logger.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Security Middleware ───────────────────────────────────────────────────────

// Helmet: sets various HTTP headers for security
// Configure to allow serving images from /uploads
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// CORS: allow requests from frontend origin
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:3000',
  'http://localhost:3000',
  'http://localhost:3001',
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS policy: origin ${origin} not allowed`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Rate limiting: 100 requests per minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
});
app.use('/api/', limiter);

// ─── Request Parsing Middleware ────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Logging Middleware ────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
}

// ─── Static Files ──────────────────────────────────────────────────────────────

// Serve uploaded product images as static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ─── API Routes ────────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/upload', uploadRoutes);

// ─── Health Check ──────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// ─── 404 Handler ───────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    error: `Route ${req.method} ${req.originalUrl} not found.`,
    code: 'NOT_FOUND',
  });
});

// ─── Centralized Error Handler ─────────────────────────────────────────────────

app.use(errorHandler);

// ─── Start Server ──────────────────────────────────────────────────────────────

const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      logger.info(`Ballers backend running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`);
      logger.info(`Uploads served at /uploads`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app; // Export for testing
