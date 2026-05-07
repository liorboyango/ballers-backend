/**
 * Ballers Backend — Server Entry Point
 *
 * Loads env, validates required vars, connects to Firestore, and starts
 * the HTTP server. The Express app itself lives in src/app.js so that
 * tests can import it without spinning up a listener.
 */
require('dotenv').config();

const app = require('./app');
const connectDB = require('./services/db');
const logger = require('./utils/logger');

const REQUIRED_ENV_VARS = ['FIREBASE_SERVICE_ACCOUNT', 'JWT_SECRET'];
const missingVars = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
if (missingVars.length > 0) {
  logger.error(`Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

const PORT = process.env.PORT || 5000;

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
