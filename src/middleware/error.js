/**
 * Centralized Error Handling Middleware
 *
 * Provides consistent JSON error responses across the entire API.
 * Handles Mongoose validation errors, cast errors, duplicate key errors,
 * JWT errors, and generic server errors.
 */

'use strict';

const logger = require('../utils/logger');

/**
 * 404 Not Found handler.
 * Called when no route matches the incoming request.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function notFoundHandler(req, res, next) {
  const err = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  err.statusCode = 404;
  next(err);
}

/**
 * Centralized error handler middleware.
 * Must be registered LAST in the middleware chain.
 *
 * Handles the following error types:
 * - Mongoose ValidationError (400)
 * - Mongoose CastError / invalid ObjectId (400)
 * - Mongoose duplicate key error (409)
 * - JWT errors (401)
 * - Custom errors with statusCode property
 * - Generic server errors (500)
 *
 * @param {Error} err - The error object
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || 'Internal Server Error';
  let errors = null;

  // ── Mongoose Validation Error ──────────────────────────────────────────────
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed.';
    errors = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
  }

  // ── Mongoose CastError (invalid ObjectId) ─────────────────────────────────
  else if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid value for field '${err.path}': ${err.value}`;
  }

  // ── MongoDB Duplicate Key Error ───────────────────────────────────────────
  else if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `A record with this ${field} already exists.`;
  }

  // ── JWT Errors ────────────────────────────────────────────────────────────
  else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid authentication token.';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Authentication token has expired.';
  }

  // ── Log server errors (5xx) ───────────────────────────────────────────────
  if (statusCode >= 500) {
    logger.error(`[${req.method}] ${req.originalUrl} - ${statusCode}: ${message}`, {
      stack: err.stack,
      body: req.body,
      params: req.params,
      query: req.query,
      user: req.user ? req.user.id : 'unauthenticated',
    });
  } else {
    logger.warn(`[${req.method}] ${req.originalUrl} - ${statusCode}: ${message}`);
  }

  // ── Build response ────────────────────────────────────────────────────────
  const response = {
    success: false,
    error: message,
  };

  if (errors) {
    response.errors = errors;
  }

  // Include stack trace in development only
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

/**
 * Async route handler wrapper.
 * Wraps async route handlers to automatically catch rejected promises
 * and forward them to the centralized error handler.
 *
 * @param {Function} fn - Async route handler function
 * @returns {import('express').RequestHandler}
 *
 * @example
 * router.get('/', asyncHandler(async (req, res) => {
 *   const data = await someAsyncOperation();
 *   res.json({ success: true, data });
 * }));
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { notFoundHandler, errorHandler, asyncHandler };
