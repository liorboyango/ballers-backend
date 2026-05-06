/**
 * Product & Team Routes
 * GET  /api/teams              - List all teams
 * GET  /api/teams/:id          - Get team by ID
 * GET  /api/products           - List products (filter: ?teamId, ?kitType, ?size, ?featured)
 * GET  /api/products/:id       - Get product by ID
 * POST /api/products           - Create product (admin only, with image upload)
 * PUT  /api/products/:id       - Update product (admin only)
 * DELETE /api/products/:id     - Delete product (admin only)
 */

const express = require('express');
const router = express.Router();

const {
  getTeams,
  getTeamById,
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} = require('../../controllers/productCtrl');
const { protect, adminOnly } = require('../../middleware/auth');
const upload = require('../../services/upload');

// Team routes
router.get('/teams', getTeams);
router.get('/teams/:id', getTeamById);

// Product routes
router.get('/products', getProducts);
router.get('/products/:id', getProductById);
router.post('/products', protect, adminOnly, upload.single('image'), createProduct);
router.put('/products/:id', protect, adminOnly, upload.single('image'), updateProduct);
router.delete('/products/:id', protect, adminOnly, deleteProduct);

module.exports = router;
