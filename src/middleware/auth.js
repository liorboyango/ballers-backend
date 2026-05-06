/**
 * Authentication Middleware
 *
 * Verifies JWT tokens on protected routes.
 * Attaches the decoded user payload to req.user.
 */

'use strict';

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * Middleware to authenticate requests using JWT Bearer tokens.
 *
 * Expects the Authorization header in the format:
 *   Authorization: Bearer <token>
 *
 * On success: attaches decoded payload to req.user and calls next().
 * On failure: responds with 401 Unauthorized.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Access denied. No token provided.',
    });
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access denied. Malformed authorization header.',
    });
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      logger.error('JWT_SECRET is not configured.');
      return res.status(500).json({
        success: false,
        error: 'Internal server error. Authentication service misconfigured.',
      });
    }

    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token has expired. Please log in again.',
      });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token.',
      });
    }
    logger.error(`JWT verification error: ${err.message}`);
    return res.status(401).json({
      success: false,
      error: 'Authentication failed.',
    });
  }
}

/**
 * Optional authentication middleware.
 * Attaches user to req.user if a valid token is present,
 * but does NOT block the request if no token is provided.
 * Useful for routes that behave differently for authenticated users.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      req.user = null;
      return next();
    }
    req.user = jwt.verify(token, secret);
  } catch {
    req.user = null;
  }

  next();
}

/**
 * Authorization middleware factory.
 * Restricts access to users with specific roles.
 *
 * @param {...string} roles - Allowed roles (e.g., 'admin', 'user')
 * @returns {import('express').RequestHandler}
 *
 * @example
 * router.delete('/product/:id', authenticate, authorize('admin'), deleteProduct);
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
    }

    if (!roles.includes(req.user.role)) {
      logger.warn(
        `Authorization denied for user ${req.user.id} with role '${req.user.role}'. Required: [${roles.join(', ')}]`
      );
      return res.status(403).json({
        success: false,
        error: 'You do not have permission to perform this action.',
      });
    }

    next();
  };
}

module.exports = { authenticate, optionalAuthenticate, authorize };
