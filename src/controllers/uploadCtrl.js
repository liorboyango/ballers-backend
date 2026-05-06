/**
 * Upload Controller
 * Handles product image upload operations including single/multiple uploads
 * and image deletion.
 */

const path = require('path');
const fs = require('fs');
const { deleteUploadedFile, getFileUrl, UPLOADS_DIR } = require('../services/upload');
const Product = require('../models/Product');
const logger = require('../utils/logger');

/**
 * Upload a single product image
 * POST /api/upload/product-image
 * Protected route - requires authentication
 *
 * @param {Object} req - Express request (file attached by Multer middleware)
 * @param {Object} res - Express response
 */
const uploadProductImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No image file provided. Please upload an image.',
        code: 'NO_FILE',
      });
    }

    const { filename, originalname, mimetype, size } = req.file;
    const imageUrl = getFileUrl(filename);

    logger.info(`Product image uploaded: ${filename} (${size} bytes)`);

    return res.status(201).json({
      message: 'Image uploaded successfully.',
      image: {
        filename,
        originalName: originalname,
        url: imageUrl,
        mimetype,
        size,
      },
    });
  } catch (error) {
    logger.error('Error uploading product image:', error);
    return res.status(500).json({
      error: 'Failed to upload image. Please try again.',
      code: 'UPLOAD_FAILED',
    });
  }
};

/**
 * Upload multiple product images
 * POST /api/upload/product-images
 * Protected route - requires authentication
 *
 * @param {Object} req - Express request (files attached by Multer middleware)
 * @param {Object} res - Express response
 */
const uploadProductImages = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'No image files provided. Please upload at least one image.',
        code: 'NO_FILES',
      });
    }

    const uploadedImages = req.files.map((file) => ({
      filename: file.filename,
      originalName: file.originalname,
      url: getFileUrl(file.filename),
      mimetype: file.mimetype,
      size: file.size,
    }));

    logger.info(`${uploadedImages.length} product images uploaded`);

    return res.status(201).json({
      message: `${uploadedImages.length} image(s) uploaded successfully.`,
      images: uploadedImages,
    });
  } catch (error) {
    logger.error('Error uploading product images:', error);
    return res.status(500).json({
      error: 'Failed to upload images. Please try again.',
      code: 'UPLOAD_FAILED',
    });
  }
};

/**
 * Delete an uploaded product image
 * DELETE /api/upload/:filename
 * Protected route - requires authentication
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
const deleteProductImage = async (req, res) => {
  try {
    const { filename } = req.params;

    // Sanitize filename to prevent path traversal attacks
    const sanitizedFilename = path.basename(filename);
    if (sanitizedFilename !== filename) {
      return res.status(400).json({
        error: 'Invalid filename.',
        code: 'INVALID_FILENAME',
      });
    }

    // Check if file exists
    const filePath = path.join(UPLOADS_DIR, sanitizedFilename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: 'Image not found.',
        code: 'FILE_NOT_FOUND',
      });
    }

    // Remove image reference from any products using it
    const imageUrl = getFileUrl(sanitizedFilename);
    await Product.updateMany(
      { $or: [{ imageUrl }, { images: imageUrl }] },
      { $pull: { images: imageUrl }, $unset: { imageUrl: '' } }
    );

    // Delete the file
    await deleteUploadedFile(sanitizedFilename);

    logger.info(`Product image deleted: ${sanitizedFilename}`);

    return res.status(200).json({
      message: 'Image deleted successfully.',
      filename: sanitizedFilename,
    });
  } catch (error) {
    logger.error('Error deleting product image:', error);
    return res.status(500).json({
      error: 'Failed to delete image. Please try again.',
      code: 'DELETE_FAILED',
    });
  }
};

/**
 * Attach an uploaded image to a product
 * PUT /api/upload/attach/:productId
 * Protected route - requires authentication
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
const attachImageToProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const { imageUrl, isPrimary } = req.body;

    if (!imageUrl) {
      return res.status(400).json({
        error: 'imageUrl is required.',
        code: 'MISSING_IMAGE_URL',
      });
    }

    // Validate that the image URL points to an existing file
    const filename = path.basename(imageUrl);
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: 'Image file not found. Please upload the image first.',
        code: 'FILE_NOT_FOUND',
      });
    }

    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        error: 'Product not found.',
        code: 'PRODUCT_NOT_FOUND',
      });
    }

    // Add image to product's images array if not already present
    if (!product.images.includes(imageUrl)) {
      product.images.push(imageUrl);
    }

    // Set as primary image if requested or if it's the first image
    if (isPrimary || !product.imageUrl) {
      product.imageUrl = imageUrl;
    }

    await product.save();

    logger.info(`Image ${imageUrl} attached to product ${productId}`);

    return res.status(200).json({
      message: 'Image attached to product successfully.',
      product: {
        _id: product._id,
        name: product.name,
        imageUrl: product.imageUrl,
        images: product.images,
      },
    });
  } catch (error) {
    logger.error('Error attaching image to product:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        error: 'Invalid product ID.',
        code: 'INVALID_ID',
      });
    }
    return res.status(500).json({
      error: 'Failed to attach image to product.',
      code: 'ATTACH_FAILED',
    });
  }
};

module.exports = {
  uploadProductImage,
  uploadProductImages,
  deleteProductImage,
  attachImageToProduct,
};
