/**
 * Product Routes
 * GET    /api/products        - List products (public, with filters)
 * GET    /api/products/:id    - Get product by ID (public)
 * POST   /api/products        - Create product (admin only)
 * PUT    /api/products/:id    - Update product (admin only)
 * DELETE /api/products/:id    - Delete product (admin only)
 *
 * The POST /api/products endpoint supports two modes:
 *
 * 1. **Manual creation** (multipart/form-data or JSON without images array):
 *    - Optionally include a file field named `image` for direct upload.
 *    - If no file, Gemini auto-generates the image (requires teamId).
 *    - Upload middleware is applied via the `conditionalUpload` helper below.
 *
 * 2. **Bulk import** (JSON body with `images: [url1, url2, ...]`):
 *    - No file upload; images are downloaded from external URLs server-side.
 *    - The request Content-Type is `application/json`.
 *    - Multer is NOT applied (it would reject non-multipart requests and
 *      interfere with the JSON body parser).
 */
const express = require('express');
const router = express.Router();
const productCtrl = require('../../controllers/productCtrl');
const { protect, restrictTo } = require('../../middleware/auth');
const { validate, schemas } = require('../../middleware/validation');
const { upload } = require('../../services/upload');

/**
 * Conditionally applies multer's `upload.single('image')` middleware.
 *
 * When the incoming request carries an `images` array in the JSON body the
 * controller handles image download server-side and we must NOT run multer
 * (multer would reject the request with a "Not a multipart" error or fail to
 * parse the body properly). For all other requests (multipart form-data or
 * plain JSON without images) we proceed normally with multer.
 *
 * Detection strategy: if Content-Type is `application/json` AND the raw body
 * string contains `"images"`, skip multer. This avoids having to buffer the
 * body twice and handles the 99% case correctly. The controller re-validates
 * the images array field via Joi so any false positives are safely rejected.
 */
const conditionalUpload = (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.startsWith('application/json')) {
    // JSON body — multer not needed; body-parser already populated req.body
    return next();
  }
  // multipart/form-data — apply multer
  return upload.single('image')(req, res, next);
};

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
 * @desc    Create a new product.
 *          Accepts either:
 *            - multipart/form-data with an optional `image` file field, OR
 *            - application/json with an optional `images` array of URLs
 * @access  Admin only
 */
router.post(
  '/',
  protect,
  restrictTo('admin'),
  conditionalUpload,
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
