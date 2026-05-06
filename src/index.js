/**
 * Ballers Backend - Main Entry Point
 *
 * Initializes the Express server, connects to MongoDB,
 * registers all middleware and routes, and starts listening.
 */

'use strict';

require('dotenv').config();

const app = require('./app');
const { connectDB } = require('./services/db');
const logger = require('./utils/logger');
const { validateEnv } = require('./utils/validateEnv');

// ─── Validate required environment variables before anything else ────────────
try {
  validateEnv();
} catch (err) {
  logger.error(`Environment validation failed: ${err.message}`);
  process.exit(1);
}

const PORT = process.env.PORT || 5000;

/**
 * Graceful shutdown handler.
 * Closes the HTTP server and MongoDB connection cleanly.
 *
 * @param {http.Server} server - The running HTTP server instance
 * @param {string} signal - The OS signal that triggered shutdown
 */
function gracefulShutdown(server, signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  server.close(async () => {
    logger.info('HTTP server closed.');
    const mongoose = require('mongoose');
    try {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed.');
    } catch (err) {
      logger.error(`Error closing MongoDB connection: ${err.message}`);
    }
    process.exit(0);
  });

  // Force shutdown after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 10_000);
}

/**
 * Bootstrap the application:
 * 1. Connect to MongoDB
 * 2. Start the HTTP server
 */
async function bootstrap() {
  try {
    await connectDB();

    const server = app.listen(PORT, () => {
      logger.info(
        `Ballers API server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`
      );
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
      gracefulShutdown(server, 'unhandledRejection');
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      logger.error(`Uncaught Exception: ${err.message}`, { stack: err.stack });
      gracefulShutdown(server, 'uncaughtException');
    });

    // Handle termination signals
    process.on('SIGTERM', () => gracefulShutdown(server, 'SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown(server, 'SIGINT'));

    return server;
  } catch (err) {
    logger.error(`Failed to start server: ${err.message}`, { stack: err.stack });
    process.exit(1);
  }
}

bootstrap();
