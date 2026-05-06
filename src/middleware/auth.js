/**
 * JWT Authentication Middleware
 * Verifies the JWT token from the Authorization header.
 * Attaches the user (without password) to req.user for downstream handlers.
 */
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

exports.protect = asyncHandler(async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return next(
      new AppError('Authentication required. Please log in to access this resource.', 401)
    );
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new AppError('Your session has expired. Please log in again.', 401));
    }
    return next(new AppError('Invalid authentication token. Please log in again.', 401));
  }

  const snap = await User.collection().doc(decoded.id).get();
  if (!snap.exists) {
    return next(
      new AppError('The user associated with this token no longer exists.', 401)
    );
  }

  const user = User.serialize(snap);
  if (user.isActive === false) {
    return next(
      new AppError('Your account has been deactivated. Please contact support.', 403)
    );
  }

  req.user = user;
  next();
});

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
