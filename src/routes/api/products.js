/**
 * Product Routes
 * GET    /api/products        - List products (public, with filters)
 * GET    /api/products/:id    - Get product by ID (public)
 * POST   /api/products        - Create product (admin only)
 * PUT    /api/products/:id    - Update product (admin only)
 * DELETE /api/products/:id    - Delete product (admin only)
 */
const express = require('express');
const router = express.Router();
const productCtrl = require('../../controllers/productCtrl');
const { protect, restrictTo } = require('../../middleware/auth');
const { validate, schemas } = require('../../middleware/validation');
const { upload } = require('../../services/upload');

/**
 * @route   GET /api/products
 * @desc    List all products with optional filtering and pagination
 * @access  Public
 */
router.get('/', validate(schemas.getProductsQuery, 'query'), productCtrl.getProducts);

/**
 * @route   GET /api/products/:id
 * @desc    Get a single product by ID
 * @access  Public
 */
router.get('/:id', validate(schemas.objectIdParam, 'params'), productCtrl.getProductById);

/**
 * @route   POST /api/products
 * @desc    Create a new product with optional image upload
 * @access  Admin only
 */
router.post(
  '/',
  protect,
  restrictTo('admin'),
  upload.single('image'),
  validate(schemas.createProduct),
  productCtrl.createProduct
);

/**
 * @route   PUT /api/products/:id
 * @desc    Update an existing product
 * @access  Admin only
 */
router.put(
  '/:id',
  protect,
  restrictTo('admin'),
  validate(schemas.objectIdParam, 'params'),
  upload.single('image'),
  productCtrl.updateProduct
);

/**
 * @route   DELETE /api/products/:id
 * @desc    Delete a product
 * @access  Admin only
 */
router.delete(
  '/:id',
  protect,
  restrictTo('admin'),
  validate(schemas.objectIdParam, 'params'),
  productCtrl.deleteProduct
);

module.exports = router;
