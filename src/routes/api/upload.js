/**
 * Upload Routes
 * Defines API endpoints for product image file uploads.
 * All mutating routes are protected and require JWT authentication.
 *
 * Cache-Control headers are set by the controller on every response that
 * returns an image URL so that HTTP clients, reverse proxies, and CDN edge
 * nodes cache the resource for the full 1-year TTL.
 */

const express = require('express');
const router = express.Router();
const { protect } = require('../../middleware/auth');
const { upload } = require('../../services/upload');
const {
  uploadProductImage,
  uploadProductImages,
  deleteProductImage,
  attachImageToProduct,
  getImageInfo,
} = require('../../controllers/uploadCtrl');

/**
 * @route   POST /api/upload/product-image
 * @desc    Upload a single product image to Firebase Storage
 * @access  Protected (requires JWT)
 * @body    multipart/form-data with field 'image'
 * @returns { message, image: { originalName, url, mimetype, size, cacheControl } }
 */
router.post(
  '/product-image',
  protect,
  upload.single('image'),
  uploadProductImage
);

/**
 * @route   POST /api/upload/product-images
 * @desc    Upload multiple product images (max 10) to Firebase Storage
 * @access  Protected (requires JWT)
 * @body    multipart/form-data with field 'images' (multiple files)
 * @returns { message, images: [{ originalName, url, mimetype, size, cacheControl }] }
 */
router.post(
  '/product-images',
  protect,
  upload.array('images', 10),
  uploadProductImages
);

/**
 * @route   GET /api/upload/image-info
 * @desc    Retrieve metadata and cache headers for a stored image URL
 * @access  Public (read-only, no auth required)
 * @query   url - Full Firebase Storage public URL of the image
 * @returns { url, name, contentType, size, cacheControl, updated, etag }
 */
router.get('/image-info', getImageInfo);

/**
 * @route   PUT /api/upload/attach/:productId
 * @desc    Attach an uploaded image URL to a product document
 * @access  Protected (requires JWT)
 * @param   productId - Firestore document id of the product
 * @body    { imageUrl: string }
 * @returns { message, product: { id, imageUrl, cacheControl } }
 */
router.put('/attach/:productId', protect, attachImageToProduct);

/**
 * @route   DELETE /api/upload
 * @desc    Delete an uploaded product image from Firebase Storage
 * @access  Protected (requires JWT)
 * @query   url - Full Firebase Storage public URL of the image to delete
 * @returns { message, url }
 */
router.delete('/', protect, deleteProductImage);

module.exports = router;
