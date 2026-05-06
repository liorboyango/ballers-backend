/**
 * Authentication Controller
 * Handles user registration and login with JWT
 */

const User = require('../models/User');
const jwt = require('jsonwebtoken');
const Joi = require('joi');

// ─── Validation Schemas ───────────────────────────────────────────────────────

const registerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(100).required().messages({
    'string.min': 'Name must be at least 2 characters',
    'string.max': 'Name must not exceed 100 characters',
    'any.required': 'Name is required',
  }),
  email: Joi.string().trim().email().lowercase().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string().min(8).max(128).required().messages({
    'string.min': 'Password must be at least 8 characters',
    'string.max': 'Password must not exceed 128 characters',
    'any.required': 'Password is required',
  }),
});

const loginSchema = Joi.object({
  email: Joi.string().trim().email().lowercase().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string().required().messages({
    'any.required': 'Password is required',
  }),
});

// ─── Helper: Generate JWT ─────────────────────────────────────────────────────

/**
 * Generate a signed JWT for the given user.
 * @param {Object} user - Mongoose User document
 * @returns {string} Signed JWT token
 */
const generateToken = (user) => {
  const payload = {
    id: user._id,
    email: user.email,
    role: user.role,
  };

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    issuer: 'ballers-api',
    audience: 'ballers-client',
  });
};

// ─── Helper: Safe User Response ───────────────────────────────────────────────

/**
 * Return a safe user object (no password hash).
 * @param {Object} user - Mongoose User document
 * @returns {Object} Safe user data
 */
const safeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt,
});

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 * Register a new user account.
 *
 * Body: { name, email, password }
 * Returns: { message, token, user }
 */
const register = async (req, res, next) => {
  try {
    // 1. Validate request body
    const { error, value } = registerSchema.validate(req.body, { abortEarly: false });
    if (error) {
      const messages = error.details.map((d) => d.message);
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: messages,
      });
    }

    const { name, email, password } = value;

    // 2. Check for duplicate email
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'An account with this email already exists',
      });
    }

    // 3. Create user (password hashed by pre-save hook in User model)
    const user = await User.create({ name, email, password });

    // 4. Generate JWT
    const token = generateToken(user);

    // 5. Respond
    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: safeUser(user),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/login
 * Authenticate an existing user and return a JWT.
 *
 * Body: { email, password }
 * Returns: { message, token, user }
 */
const login = async (req, res, next) => {
  try {
    // 1. Validate request body
    const { error, value } = loginSchema.validate(req.body, { abortEarly: false });
    if (error) {
      const messages = error.details.map((d) => d.message);
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: messages,
      });
    }

    const { email, password } = value;

    // 2. Find user (include password field for comparison)
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      // Use generic message to avoid user enumeration
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password',
      });
    }

    // 3. Compare password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password',
      });
    }

    // 4. Generate JWT
    const token = generateToken(user);

    // 5. Respond
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: safeUser(user),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth/me
 * Return the currently authenticated user's profile.
 * Requires: auth middleware
 */
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      user: safeUser(user),
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, getMe };
