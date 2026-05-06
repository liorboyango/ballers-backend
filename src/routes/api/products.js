/**
 * Product Routes
 * Defines API endpoints for product management including image upload support.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const {
  handleSingleImageUpload,
  handleMultipleImagesUpload,
} = require('../../services/upload');
const { validateUploadedFile, validateUploadedFiles } = require('../../middleware/uploadValidation');
const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} = require('../../controllers/productCtrl');

/**
 * @route   GET /api/products
 * @desc    Get all products, optionally filtered by teamId
 * @access  Public
 * @query   teamId - Filter products by team
 * @query   page - Page number (default: 1)
 * @query   limit - Items per page (default: 20)
 * @returns { products: [], total, page, pages }
 */
router.get('/', getProducts);

/**
 * @route   GET /api/products/:id
 * @desc    Get a single product by ID
 * @access  Public
 * @param   id - MongoDB ObjectId of the product
 * @returns { product }
 */
router.get('/:id', getProductById);

/**
 * @route   POST /api/products
 * @desc    Create a new product with optional image upload
 * @access  Protected (requires JWT)
 * @body    multipart/form-data or application/json
 *          Required: name, teamId, price, category
 *          Optional: image (file), description, sizes, customization options
 * @returns { product }
 */
router.post(
  '/',
  authenticate,
  handleSingleImageUpload,
  validateUploadedFile,
  createProduct
);

/**
 * @route   PUT /api/products/:id
 * @desc    Update a product with optional image upload
 * @access  Protected (requires JWT)
 * @param   id - MongoDB ObjectId of the product
 * @body    multipart/form-data or application/json
 * @returns { product }
 */
router.put(
  '/:id',
  authenticate,
  handleSingleImageUpload,
  validateUploadedFile,
  updateProduct
);

/**
 * @route   DELETE /api/products/:id
 * @desc    Delete a product
 * @access  Protected (requires JWT)
 * @param   id - MongoDB ObjectId of the product
 * @returns { message }
 */
router.delete('/:id', authenticate, deleteProduct);

module.exports = router;
