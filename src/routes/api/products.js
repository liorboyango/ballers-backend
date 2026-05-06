/**
 * Products Routes
 *
 * Placeholder routes for product endpoints.
 * Full implementation in Task 3 (product controllers).
 */

'use strict';

const express = require('express');
const router = express.Router();

/**
 * @route   GET /api/products
 * @desc    Get all products (optionally filtered by teamId)
 * @access  Public
 */
router.get('/', (req, res) => {
  res.status(501).json({
    success: false,
    error: 'Not implemented yet. Coming in Task 3.',
  });
});

/**
 * @route   GET /api/products/:id
 * @desc    Get a single product by ID
 * @access  Public
 */
router.get('/:id', (req, res) => {
  res.status(501).json({
    success: false,
    error: 'Not implemented yet. Coming in Task 3.',
  });
});

/**
 * @route   POST /api/products
 * @desc    Create a new product (admin only)
 * @access  Protected (admin)
 */
router.post('/', (req, res) => {
  res.status(501).json({
    success: false,
    error: 'Not implemented yet. Coming in Task 7.',
  });
});

module.exports = router;
