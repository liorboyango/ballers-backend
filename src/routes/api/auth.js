/**
 * Authentication Routes
 * POST /api/auth/register - Register new user
 * POST /api/auth/login    - Login and get JWT
 * GET  /api/auth/me       - Get current user profile (protected)
 */
const express = require('express');
const router = express.Router();
const authCtrl = require('../../controllers/authCtrl');
const { protect } = require('../../middleware/auth');
const { validate, schemas } = require('../../middleware/validation');

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user account
 * @access  Public
 */
router.post('/register', validate(schemas.register), authCtrl.register);

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user and return JWT token
 * @access  Public
 */
router.post('/login', validate(schemas.login), authCtrl.login);

/**
 * @route   GET /api/auth/me
 * @desc    Get current authenticated user's profile
 * @access  Protected
 */
router.get('/me', protect, authCtrl.getMe);

module.exports = router;
