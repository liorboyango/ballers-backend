/**
 * Upload Controller
 * Handles product image upload operations including single/multiple uploads
 * and image deletion. Images are stored in Firebase Storage; the resulting
 * public URL is what gets attached to product documents.
 *
 * NOTE: this controller is not currently mounted in src/index.js. The product
 * controller's create/update flow handles image uploads inline via
 * services/upload.uploadProductImage. These handlers are kept for the
 * routes/api/upload.js wiring referenced in older docs.
 */

const { admin } = require('../services/db');
const {
  uploadProductImage: storageUpload,
  deleteProductImage: storageDelete,
} = require('../services/upload');
const Product = require('../models/Product');
const logger = require('../utils/logger');

const uploadProductImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No image file provided. Please upload an image.',
        code: 'NO_FILE',
      });
    }

    const url = await storageUpload(req.file);
    const { originalname, mimetype, size } = req.file;

    logger.info(`Product image uploaded to storage: ${url} (${size} bytes)`);

    return res.status(201).json({
      message: 'Image uploaded successfully.',
      image: {
        originalName: originalname,
        url,
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

const uploadProductImages = async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'No image files provided. Please upload at least one image.',
        code: 'NO_FILES',
      });
    }

    const uploadedImages = await Promise.all(
      req.files.map(async (file) => ({
        originalName: file.originalname,
        url: await storageUpload(file),
        mimetype: file.mimetype,
        size: file.size,
      }))
    );

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
 * DELETE /api/upload?url=<image-url>
 * Removes the image from Storage and clears any product references to it.
 */
const deleteProductImage = async (req, res) => {
  try {
    const url = req.query.url || req.body.url;
    if (!url) {
      return res.status(400).json({
        error: 'Image URL is required.',
        code: 'MISSING_URL',
      });
    }

    const matches = await Product.collection().where('imageUrl', '==', url).get();
    if (!matches.empty) {
      const batch = admin.firestore().batch();
      matches.docs.forEach((doc) => {
        batch.update(doc.ref, { imageUrl: admin.firestore.FieldValue.delete() });
      });
      await batch.commit();
    }

    await storageDelete(url);

    logger.info(`Product image deleted: ${url}`);

    return res.status(200).json({
      message: 'Image deleted successfully.',
      url,
    });
  } catch (error) {
    logger.error('Error deleting product image:', error);
    return res.status(500).json({
      error: 'Failed to delete image. Please try again.',
      code: 'DELETE_FAILED',
    });
  }
};

const attachImageToProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({
        error: 'imageUrl is required.',
        code: 'MISSING_IMAGE_URL',
      });
    }

    const ref = Product.collection().doc(productId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({
        error: 'Product not found.',
        code: 'PRODUCT_NOT_FOUND',
      });
    }

    await ref.update({
      imageUrl,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info(`Image ${imageUrl} attached to product ${productId}`);

    return res.status(200).json({
      message: 'Image attached to product successfully.',
      product: {
        id: productId,
        imageUrl,
      },
    });
  } catch (error) {
    logger.error('Error attaching image to product:', error);
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
