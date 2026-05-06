/**
 * Auth Routes
 *
 * Placeholder routes for authentication endpoints.
 * Full implementation in Task 4 (auth controllers).
 */

'use strict';

const express = require('express');
const router = express.Router();

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', (req, res) => {
  res.status(501).json({
    success: false,
    error: 'Not implemented yet. Coming in Task 4.',
  });
});

/**
 * @route   POST /api/auth/login
 * @desc    Login user and return JWT
 * @access  Public
 */
router.post('/login', (req, res) => {
  res.status(501).json({
    success: false,
    error: 'Not implemented yet. Coming in Task 4.',
  });
});

/**
 * @route   GET /api/auth/me
 * @desc    Get current authenticated user profile
 * @access  Protected
 */
router.get('/me', (req, res) => {
  res.status(501).json({
    success: false,
    error: 'Not implemented yet. Coming in Task 4.',
  });
});

module.exports = router;
