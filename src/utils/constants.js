/**
 * Application Constants
 *
 * Centralized constants used across the backend application.
 * Avoids magic numbers/strings scattered throughout the codebase.
 */

'use strict';

/** Rate limiting configuration */
const RATE_LIMIT = {
  /** Time window in milliseconds (1 minute) */
  WINDOW_MS: 60 * 1000,
  /** Maximum requests per window per IP */
  MAX_REQUESTS: 100,
  /** Stricter limit for auth endpoints */
  AUTH_MAX_REQUESTS: 10,
};

/** JWT configuration */
const JWT = {
  /** Token expiry duration */
  EXPIRES_IN: '24h',
  /** Refresh token expiry */
  REFRESH_EXPIRES_IN: '7d',
};

/** Bcrypt configuration */
const BCRYPT = {
  /** Salt rounds for password hashing (12 is a good balance of security/performance) */
  SALT_ROUNDS: 12,
};

/** File upload configuration */
const UPLOAD = {
  /** Maximum file size in bytes (5MB) */
  MAX_FILE_SIZE: 5 * 1024 * 1024,
  /** Allowed MIME types for product images */
  ALLOWED_MIME_TYPES: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  /** Upload destination directory */
  DEST: 'uploads/',
};

/** Pagination defaults */
const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
};

/** User roles */
const USER_ROLES = {
  USER: 'user',
  ADMIN: 'admin',
};

/** Order statuses */
const ORDER_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PROCESSING: 'processing',
  SHIPPED: 'shipped',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
};

/** Product kit types */
const KIT_TYPE = {
  HOME: 'home',
  AWAY: 'away',
  THIRD: 'third',
  GOALKEEPER: 'goalkeeper',
};

/** Available shirt sizes */
const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

/** HTTP status codes (commonly used) */
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
  NOT_IMPLEMENTED: 501,
};

module.exports = {
  RATE_LIMIT,
  JWT,
  BCRYPT,
  UPLOAD,
  PAGINATION,
  USER_ROLES,
  ORDER_STATUS,
  KIT_TYPE,
  SHIRT_SIZES,
  HTTP_STATUS,
};
