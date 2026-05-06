/**
 * Upload Routes
 * Defines API endpoints for product image file uploads.
 * All routes are protected and require JWT authentication.
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const {
  handleSingleImageUpload,
  handleMultipleImagesUpload,
} = require('../../services/upload');
const {
  uploadProductImage,
  uploadProductImages,
  deleteProductImage,
  attachImageToProduct,
} = require('../../controllers/uploadCtrl');

/**
 * @route   POST /api/upload/product-image
 * @desc    Upload a single product image
 * @access  Protected (requires JWT)
 * @body    multipart/form-data with field 'image'
 * @returns { message, image: { filename, originalName, url, mimetype, size } }
 */
router.post(
  '/product-image',
  authenticate,
  handleSingleImageUpload,
  uploadProductImage
);

/**
 * @route   POST /api/upload/product-images
 * @desc    Upload multiple product images (max 10)
 * @access  Protected (requires JWT)
 * @body    multipart/form-data with field 'images' (multiple files)
 * @returns { message, images: [{ filename, originalName, url, mimetype, size }] }
 */
router.post(
  '/product-images',
  authenticate,
  handleMultipleImagesUpload,
  uploadProductImages
);

/**
 * @route   DELETE /api/upload/:filename
 * @desc    Delete an uploaded product image
 * @access  Protected (requires JWT)
 * @param   filename - Name of the file to delete
 * @returns { message, filename }
 */
router.delete('/:filename', authenticate, deleteProductImage);

/**
 * @route   PUT /api/upload/attach/:productId
 * @desc    Attach an uploaded image to a product
 * @access  Protected (requires JWT)
 * @param   productId - MongoDB ObjectId of the product
 * @body    { imageUrl: string, isPrimary?: boolean }
 * @returns { message, product: { _id, name, imageUrl, images } }
 */
router.put('/attach/:productId', authenticate, attachImageToProduct);

module.exports = router;
