/**
 * MongoDB Database Connection Service
 * Establishes and manages the Mongoose connection to MongoDB.
 * Implements retry logic and connection event logging.
 */
const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * Connect to MongoDB using the MONGO_URI environment variable
 * @returns {Promise<void>}
 */
const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error('MONGO_URI environment variable is not set.');
  }

  try {
    const conn = await mongoose.connect(mongoUri, {
      // Mongoose 8 uses these options by default, but explicit for clarity
      serverSelectionTimeoutMS: 5000, // Timeout after 5s if can't connect
      socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
    });

    logger.info(`MongoDB connected: ${conn.connection.host}`);

    // Connection event listeners
    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Attempting to reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected.');
    });

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });
  } catch (err) {
    logger.error('MongoDB connection failed:', err.message);
    throw err;
  }
};

module.exports = connectDB;
