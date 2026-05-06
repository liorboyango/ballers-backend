/**
 * Authentication Controller
 * Handles user registration and login with JWT token generation.
 * Passwords are hashed with bcrypt before storage.
 */
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');

/**
 * Generate a signed JWT token for a user
 * @param {string} userId - MongoDB user ID
 * @returns {string} Signed JWT token
 */
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  });
};

/**
 * POST /api/auth/register
 * Register a new user account
 * @body {string} name - User's display name
 * @body {string} email - User's email address (must be unique)
 * @body {string} password - Password (min 8 chars, must include upper/lower/number)
 */
exports.register = asyncHandler(async (req, res, next) => {
  const { name, email, password } = req.body;

  // Check if email is already registered
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return next(new AppError('An account with this email already exists.', 409));
  }

  // Hash password with bcrypt (salt rounds: 12)
  const hashedPassword = await bcrypt.hash(password, 12);

  // Create user
  const user = await User.create({
    name,
    email,
    password: hashedPassword,
  });

  // Generate token
  const token = generateToken(user._id);

  logger.info(`New user registered: ${email}`);

  res.status(201).json({
    status: 'success',
    message: 'Account created successfully.',
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
});

/**
 * POST /api/auth/login
 * Authenticate a user and return a JWT token
 * @body {string} email - User's email address
 * @body {string} password - User's password
 */
exports.login = asyncHandler(async (req, res, next) => {
  const { email, password } = req.body;

  // Find user and include password field (excluded by default in schema)
  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    // Use generic message to prevent email enumeration
    return next(new AppError('Invalid email or password.', 401));
  }

  // Verify password
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) {
    return next(new AppError('Invalid email or password.', 401));
  }

  // Check if account is active
  if (user.isActive === false) {
    return next(new AppError('Your account has been deactivated. Please contact support.', 403));
  }

  // Generate token
  const token = generateToken(user._id);

  logger.info(`User logged in: ${email}`);

  res.status(200).json({
    status: 'success',
    message: 'Logged in successfully.',
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

/**
 * GET /api/auth/me
 * Get current authenticated user's profile
 * Requires valid JWT token in Authorization header
 */
exports.getMe = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    return next(new AppError('User not found.', 404));
  }

  res.status(200).json({
    status: 'success',
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
});
