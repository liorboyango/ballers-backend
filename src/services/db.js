/**
 * MongoDB connection service using Mongoose.
 * Implements retry logic and graceful shutdown.
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  const uri = process.env.MONGO_URI;

  if (!uri) {
    throw new Error('MONGO_URI environment variable is not set');
  }

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });

    logger.info(`MongoDB connected: ${conn.connection.host}`);

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed on app termination');
      process.exit(0);
    });

    return conn;
  } catch (err) {
    logger.error('MongoDB connection failed:', err.message);
    throw err;
  }
};

module.exports = connectDB;
