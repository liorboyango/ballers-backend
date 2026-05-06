/**
 * Auth Controller
 * Handles user registration and login with JWT issuance.
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const logger = require('../utils/logger');
const { JWT_EXPIRES_IN } = require('../utils/constants');

/**
 * Generate a signed JWT for a user.
 * @param {string} userId
 * @returns {string} JWT token
 */
const generateToken = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

/**
 * POST /api/auth/register
 * Register a new user account.
 */
const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const user = await User.create({ name, email, password });
    const token = generateToken(user._id);

    logger.info(`New user registered: ${email}`);

    res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/auth/login
 * Authenticate user and return JWT.
 */
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Explicitly select password (it's excluded by default)
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken(user._id);

    logger.info(`User logged in: ${email}`);

    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/auth/me
 * Return the currently authenticated user's profile.
 */
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
};

module.exports = { register, login, getMe };
