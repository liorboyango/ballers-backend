/**
 * Application Constants
 * Centralized location for all magic numbers, strings, and configuration values.
 */

/** Valid jersey/kit sizes */
const VALID_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

/** Valid kit types */
const KIT_TYPES = ['home', 'away', 'third', 'goalkeeper'];

/** Valid order statuses */
const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];

/** Valid payment methods */
const PAYMENT_METHODS = ['card', 'paypal', 'stripe'];

/** JWT configuration */
const JWT_CONFIG = {
  EXPIRY: '24h',
  REFRESH_EXPIRY: '7d',
};

/** Pagination defaults */
const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
};

/** File upload limits */
const UPLOAD_LIMITS = {
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB in bytes
  ALLOWED_MIME_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.webp'],
};

/** Rate limiting */
const RATE_LIMIT = {
  WINDOW_MS: 60 * 1000, // 1 minute
  MAX_REQUESTS: 100,
  AUTH_MAX_REQUESTS: 10, // Stricter limit for auth endpoints
};

/** HTTP Status Codes (for readability) */
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
};

module.exports = {
  VALID_SIZES,
  KIT_TYPES,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  JWT_CONFIG,
  PAGINATION,
  UPLOAD_LIMITS,
  RATE_LIMIT,
  HTTP_STATUS,
};
