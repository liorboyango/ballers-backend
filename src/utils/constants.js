/**
 * Application constants and environment variable validation.
 */

const REQUIRED_ENV_VARS = ['MONGO_URI', 'JWT_SECRET'];

/**
 * Validates that all required environment variables are set.
 * Throws an error and exits if any are missing.
 */
const validateEnv = () => {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
};

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

const ORDER_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
};

const KIT_TYPES = ['home', 'away', 'third', 'goalkeeper'];

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

module.exports = { validateEnv, JWT_EXPIRES_IN, ORDER_STATUS, KIT_TYPES, SIZES };
