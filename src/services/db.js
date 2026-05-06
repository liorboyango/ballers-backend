/**
 * Database Service - MongoDB/Mongoose Connection Manager
 *
 * Handles connecting to MongoDB with retry logic,
 * connection event listeners, and graceful disconnection.
 */

'use strict';

const mongoose = require('mongoose');
const logger = require('../utils/logger');

/** Maximum number of connection retry attempts */
const MAX_RETRIES = 5;

/** Delay between retry attempts in milliseconds */
const RETRY_DELAY_MS = 5000;

/**
 * Mongoose connection options.
 * These settings are optimized for production use with MongoDB Atlas.
 */
const MONGOOSE_OPTIONS = {
  // Connection pool settings
  maxPoolSize: 10,
  minPoolSize: 2,
  socketTimeoutMS: 45000,
  serverSelectionTimeoutMS: 10000,
  heartbeatFrequencyMS: 10000,
  // Automatically use new URL parser and unified topology
  autoIndex: process.env.NODE_ENV !== 'production', // Disable auto-indexing in production
};

/**
 * Register Mongoose connection event listeners for monitoring.
 */
function registerConnectionEvents() {
  const conn = mongoose.connection;

  conn.on('connected', () => {
    logger.info(`MongoDB connected: ${conn.host}:${conn.port}/${conn.name}`);
  });

  conn.on('disconnected', () => {
    logger.warn('MongoDB disconnected.');
  });

  conn.on('reconnected', () => {
    logger.info('MongoDB reconnected.');
  });

  conn.on('error', (err) => {
    logger.error(`MongoDB connection error: ${err.message}`);
  });

  conn.on('close', () => {
    logger.info('MongoDB connection closed.');
  });
}

/**
 * Connect to MongoDB with exponential backoff retry logic.
 *
 * @param {number} [attempt=1] - Current attempt number (used for recursion)
 * @returns {Promise<mongoose.Connection>} The active Mongoose connection
 * @throws {Error} If all retry attempts are exhausted
 */
async function connectDB(attempt = 1) {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error('MONGO_URI environment variable is not defined.');
  }

  // Register event listeners only on first attempt
  if (attempt === 1) {
    registerConnectionEvents();
  }

  try {
    logger.info(`Connecting to MongoDB (attempt ${attempt}/${MAX_RETRIES})...`);
    await mongoose.connect(uri, MONGOOSE_OPTIONS);
    logger.info('MongoDB connection established successfully.');
    return mongoose.connection;
  } catch (err) {
    logger.error(`MongoDB connection attempt ${attempt} failed: ${err.message}`);

    if (attempt >= MAX_RETRIES) {
      logger.error('All MongoDB connection attempts exhausted. Exiting.');
      throw new Error(`Failed to connect to MongoDB after ${MAX_RETRIES} attempts: ${err.message}`);
    }

    const delay = RETRY_DELAY_MS * attempt; // Exponential-ish backoff
    logger.info(`Retrying MongoDB connection in ${delay / 1000}s...`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return connectDB(attempt + 1);
  }
}

/**
 * Disconnect from MongoDB gracefully.
 *
 * @returns {Promise<void>}
 */
async function disconnectDB() {
  try {
    await mongoose.connection.close();
    logger.info('MongoDB disconnected gracefully.');
  } catch (err) {
    logger.error(`Error during MongoDB disconnection: ${err.message}`);
    throw err;
  }
}

/**
 * Check if the database connection is currently active.
 *
 * @returns {boolean} True if connected, false otherwise
 */
function isConnected() {
  return mongoose.connection.readyState === 1;
}

module.exports = { connectDB, disconnectDB, isConnected };
