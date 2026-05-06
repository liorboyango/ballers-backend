/**
 * Custom Application Error Class
 * Extends native Error to include HTTP status codes and operational flags.
 * Operational errors are expected errors (validation, not found, etc.)
 * vs programming errors (bugs) which should not be exposed to clients.
 */
class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} statusCode - HTTP status code (4xx for client errors, 5xx for server errors)
   * @param {Array} [errors] - Optional array of field-level validation errors
   */
  constructor(message, statusCode, errors = null) {
    super(message);

    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true; // Marks this as an expected, handled error
    this.errors = errors; // Field-level validation errors array

    // Capture stack trace, excluding constructor call from it
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
