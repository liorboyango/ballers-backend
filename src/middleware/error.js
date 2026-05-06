/**
 * Centralized Error Handling Middleware
 * Catches all errors passed via next(err) and returns consistent JSON responses.
 * Handles JWT errors, Multer errors, Firestore errors, and custom AppErrors.
 * In development: includes stack traces. In production: hides internal details.
 */
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

const handleJWTError = () =>
  new AppError('Invalid authentication token. Please log in again.', 401);

const handleJWTExpiredError = () =>
  new AppError('Your session has expired. Please log in again.', 401);

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
 * Map common Firestore gRPC error codes to user-friendly responses.
 * See https://firebase.google.com/docs/reference/admin/error-handling
 */
const handleFirestoreError = (err) => {
  switch (err.code) {
    case 5: // NOT_FOUND
      return new AppError('Resource not found.', 404);
    case 6: // ALREADY_EXISTS
      return new AppError('Resource already exists.', 409);
    case 7: // PERMISSION_DENIED
      return new AppError('Permission denied.', 403);
    case 16: // UNAUTHENTICATED
      return new AppError('Authentication required.', 401);
    case 9: // FAILED_PRECONDITION (e.g., missing index)
      return new AppError('The query requires an index. Please contact support.', 500);
    default:
      return null;
  }
};

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

const sendErrorProd = (err, req, res) => {
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

const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, req, res);
  } else {
    let error = Object.assign(Object.create(Object.getPrototypeOf(err)), err);
    error.message = err.message;

    if (error.name === 'JsonWebTokenError') error = handleJWTError();
    if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();
    if (error.name === 'MulterError') error = handleMulterError(error);

    const firestoreMapped = handleFirestoreError(error);
    if (firestoreMapped) error = firestoreMapped;

    sendErrorProd(error, req, res);
  }
};

const notFoundHandler = (req, res, next) => {
  next(new AppError(`Route ${req.originalUrl} not found on this server.`, 404));
};

module.exports = { errorHandler, notFoundHandler };
