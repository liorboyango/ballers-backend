/**
 * JWT Authentication Middleware
 * Verifies the Bearer token from the Authorization header
 * and attaches the decoded user payload to req.user.
 */

const jwt = require('jsonwebtoken');

/**
 * protect - Middleware to guard routes that require authentication.
 *
 * Expects: Authorization: Bearer <token>
 * On success: sets req.user = { id, email, role }
 * On failure: responds with 401
 */
const protect = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please provide a valid token.',
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication token is missing.',
      });
    }

    // Verify token signature and expiry
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'ballers-api',
      audience: 'ballers-client',
    });

    // Attach user info to request
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Your session has expired. Please log in again.',
      });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid authentication token.',
      });
    }
    // Unexpected error
    return res.status(401).json({
      success: false,
      error: 'Authentication failed.',
    });
  }
};

/**
 * requireRole - Middleware factory to restrict access by user role.
 * Must be used AFTER protect middleware.
 *
 * @param {...string} roles - Allowed roles (e.g., 'admin', 'user')
 * @returns Express middleware
 *
 * Usage: router.delete('/product/:id', protect, requireRole('admin'), deleteProduct)
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required.',
    });
  }

  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      error: `Access denied. Required role: ${roles.join(' or ')}.`,
    });
  }

  next();
};

module.exports = { protect, requireRole };
