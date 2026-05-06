/**
 * Centralized Error Handling Middleware
 * Catches all errors passed via next(err) and returns consistent JSON responses.
 * Handles Mongoose errors, JWT errors, and custom AppErrors.
 * In development: includes stack traces. In production: hides internal details.
 */
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

/**
 * Handle Mongoose CastError (invalid ObjectId format)
 * @param {Error} err - Mongoose CastError
 * @returns {AppError} Formatted 400 error
 */
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}. Please provide a valid ID.`;
  return new AppError(message, 400);
};

/**
 * Handle Mongoose duplicate key error (code 11000)
 * @param {Error} err - Mongoose duplicate key error
 * @returns {AppError} Formatted 409 error
 */
const handleDuplicateFieldsDB = (err) => {
  const field = Object.keys(err.keyValue || {})[0] || 'field';
  const value = err.keyValue ? err.keyValue[field] : 'unknown';
  const message = `Duplicate value for ${field}: "${value}". Please use a different value.`;
  return new AppError(message, 409);
};

/**
 * Handle Mongoose validation errors
 * @param {Error} err - Mongoose ValidationError
 * @returns {AppError} Formatted 400 error with field details
 */
const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => ({
    field: el.path,
    message: el.message,
  }));
  const message = `Validation failed. Please check the provided data.`;
  return new AppError(message, 400, errors);
};

/**
 * Handle invalid JWT token
 * @returns {AppError} Formatted 401 error
 */
const handleJWTError = () =>
  new AppError('Invalid authentication token. Please log in again.', 401);

/**
 * Handle expired JWT token
 * @returns {AppError} Formatted 401 error
 */
const handleJWTExpiredError = () =>
  new AppError('Your session has expired. Please log in again.', 401);

/**
 * Handle Multer file upload errors
 * @param {Error} err - Multer error
 * @returns {AppError} Formatted 400 error
 */
const handleMulterError = (err) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return new AppError('File too large. Maximum size is 5MB.', 400);
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return new AppError('Unexpected file field. Only "image" field is allowed.', 400);
  }
  return new AppError(`File upload error: ${err.message}`, 400);
};

/**
 * Send detailed error response in development environment
 * Includes stack trace and full error object for debugging
 */
const sendErrorDev = (err, req, res) => {
  logger.error(`[DEV ERROR] ${err.status} ${err.statusCode}: ${err.message}`, {
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
  });

  res.status(err.statusCode).json({
    status: err.status,
    error: err,
    message: err.message,
    errors: err.errors || undefined,
    stack: err.stack,
  });
};

/**
 * Send safe error response in production environment
 * Only exposes operational errors; hides programming errors
 */
const sendErrorProd = (err, req, res) => {
  // Operational, trusted error: send message to client
  if (err.isOperational) {
    logger.warn(`[OPERATIONAL ERROR] ${err.statusCode}: ${err.message}`, {
      url: req.originalUrl,
      method: req.method,
    });

    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      errors: err.errors || undefined,
    });
  }

  // Programming or unknown error: don't leak details
  logger.error(`[UNEXPECTED ERROR] ${err.message}`, {
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
  });

  return res.status(500).json({
    status: 'error',
    message: 'Something went wrong. Please try again later.',
  });
};

/**
 * Global error handling middleware
 * Must be registered LAST in Express middleware chain (4 parameters)
 * @param {Error} err - Error object
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Express next function
 */
const errorHandler = (err, req, res, next) => {
  // Set defaults
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, req, res);
  } else {
    let error = Object.assign(Object.create(Object.getPrototypeOf(err)), err);
    error.message = err.message;

    // Transform known error types into AppErrors
    if (error.name === 'CastError') error = handleCastErrorDB(error);
    if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    if (error.name === 'ValidationError') error = handleValidationErrorDB(error);
    if (error.name === 'JsonWebTokenError') error = handleJWTError();
    if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();
    if (error.name === 'MulterError') error = handleMulterError(error);

    sendErrorProd(error, req, res);
  }
};

/**
 * 404 Not Found handler
 * Catches requests to undefined routes
 */
const notFoundHandler = (req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found on this server.`, 404));
};

module.exports = { errorHandler, notFoundHandler };
