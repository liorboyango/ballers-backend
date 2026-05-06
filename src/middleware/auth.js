/**
 * JWT Authentication Middleware
 * Verifies the JWT token from the Authorization header.
 * Attaches the decoded user payload to req.user for downstream handlers.
 */
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Protect middleware - requires valid JWT token
 * Extracts token from: Authorization: Bearer <token>
 */
exports.protect = asyncHandler(async (req, res, next) => {
  // 1. Extract token from header
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(
      new AppError('Authentication required. Please log in to access this resource.', 401)
    );
  }

  // 2. Verify token signature and expiry
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AppError('Your session has expired. Please log in again.', 401));
    }
    return next(new AppError('Invalid authentication token. Please log in again.', 401));
  }

  // 3. Check if user still exists
  const user = await User.findById(decoded.id).select('-password');
  if (!user) {
    return next(
      new AppError('The user associated with this token no longer exists.', 401)
    );
  }

  // 4. Check if account is active
  if (user.isActive === false) {
    return next(
      new AppError('Your account has been deactivated. Please contact support.', 403)
    );
  }

  // 5. Attach user to request
  req.user = user;
  next();
});

/**
 * Role-based authorization middleware
 * Must be used AFTER protect middleware
 * @param {...string} roles - Allowed roles (e.g., 'admin', 'user')
 * @returns {Function} Express middleware
 *
 * @example
 * router.delete('/products/:id', protect, restrictTo('admin'), deleteProduct);
 */
exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(
        new AppError(
          `Access denied. This action requires ${roles.join(' or ')} privileges.`,
          403
        )
      );
    }
    next();
  };
};
