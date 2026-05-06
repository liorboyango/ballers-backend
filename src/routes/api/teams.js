/**
 * Teams Routes
 *
 * Placeholder routes for team endpoints.
 * Full implementation in Task 3 (product/team controllers).
 */

'use strict';

const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/teams
 * @desc    Get all World Cup teams
 * @access  Public
 */
router.get('/', (req, res) => {
  res.status(501).json({
    success: false,
    error: 'Not implemented yet. Coming in Task 3.',
  });
});

/**
 * @route   GET /api/teams/:id
 * @desc    Get a single team by ID
 * @access  Public
 */
router.get('/:id', (req, res) => {
  res.status(501).json({
    success: false,
    error: 'Not implemented yet. Coming in Task 3.',
  });
});

module.exports = router;
