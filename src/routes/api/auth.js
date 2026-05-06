/**
 * Auth Routes
 * POST /api/auth/register  - Create a new user account
 * POST /api/auth/login     - Authenticate and receive JWT
 * GET  /api/auth/me        - Get current user profile (protected)
 */

const express = require('express');
const router = express.Router();
const { register, login, getMe } = require('../../controllers/authCtrl');
const { protect } = require('../../middleware/auth');

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 * @body    { name: string, email: string, password: string }
 * @returns { success, message, token, user }
 */
router.post('/register', register);

/**
 * @route   POST /api/auth/login
 * @desc    Login and receive JWT
 * @access  Public
 * @body    { email: string, password: string }
 * @returns { success, message, token, user }
 */
router.post('/login', login);

/**
 * @route   GET /api/auth/me
 * @desc    Get current authenticated user
 * @access  Protected (JWT required)
 * @returns { success, user }
 */
router.get('/me', protect, getMe);

module.exports = router;
