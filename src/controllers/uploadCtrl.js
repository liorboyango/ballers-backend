/**
 * Upload Controller
 * Handles product image upload operations including single/multiple uploads
 * and image deletion. Images are stored in Firebase Storage; the resulting
 * public URL is what gets attached to product documents.
 *
 * Cache-Control headers are set on every response that returns an image URL
 * so that HTTP clients, reverse proxies, and CDN edge nodes know to cache
 * the resource for the full 1-year TTL that Firebase Storage also advertises.
 */

const { admin } = require('../services/db');
const {
  uploadProductImage: storageUpload,
  deleteProductImage: storageDelete,
  IMAGE_CACHE_CONTROL,
} = require('../services/upload');
const Product = require('../models/Product');
const logger = require('../utils/logger');

/**
 * Apply Cache-Control headers to a response that carries image URL(s).
 * Using `public, max-age=31536000, immutable` mirrors the value stored in
 * Firebase Storage metadata so every layer of the caching stack is aligned.
 *
 * @param {import('express').Response} res
 */
const setImageCacheHeaders = (res) => {
  res.set({
    'Cache-Control': IMAGE_CACHE_CONTROL,
    // Vary on Accept so WebP-capable clients get the right variant
    Vary: 'Accept',
  });
};

/**
 * POST /api/upload/product-image
 * Upload a single product image.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
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

    // Set Cache-Control so CDN/proxies cache this response and the image URL
    setImageCacheHeaders(res);

    return res.status(201).json({
      message: 'Image uploaded successfully.',
      image: {
        originalName: originalname,
        url,
        mimetype,
        size,
        cacheControl: IMAGE_CACHE_CONTROL,
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
 * POST /api/upload/product-images
 * Upload multiple product images (up to 10).
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
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
        cacheControl: IMAGE_CACHE_CONTROL,
      }))
    );

    logger.info(`${uploadedImages.length} product images uploaded`);

    // Set Cache-Control so CDN/proxies cache this response and the image URLs
    setImageCacheHeaders(res);

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
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
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

/**
 * PUT /api/upload/attach/:productId
 * Attach an uploaded image URL to a product document.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
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

    // Set Cache-Control so CDN/proxies cache this response
    setImageCacheHeaders(res);

    return res.status(200).json({
      message: 'Image attached to product successfully.',
      product: {
        id: productId,
        imageUrl,
        cacheControl: IMAGE_CACHE_CONTROL,
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

/**
 * GET /api/upload/image-info?url=<image-url>
 * Returns metadata about a stored image and echoes the Cache-Control header.
 * Useful for the frontend to verify caching configuration and for CDN
 * warm-up scripts.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
const getImageInfo = async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({
        error: 'url query parameter is required.',
        code: 'MISSING_URL',
      });
    }

    // Validate that the URL belongs to our Firebase Storage bucket
    const bucket = admin.storage().bucket();
    const prefix = `https://storage.googleapis.com/${bucket.name}/`;
    if (!url.startsWith(prefix)) {
      return res.status(400).json({
        error: 'URL does not belong to this application\'s storage bucket.',
        code: 'INVALID_URL',
      });
    }

    const objectName = url.slice(prefix.length);
    const file = bucket.file(objectName);
    const [metadata] = await file.getMetadata();

    // Echo the Cache-Control header so HTTP clients and CDNs can cache this
    // info response for the same duration as the image itself
    setImageCacheHeaders(res);

    return res.status(200).json({
      url,
      name: metadata.name,
      contentType: metadata.contentType,
      size: metadata.size,
      cacheControl: metadata.cacheControl || IMAGE_CACHE_CONTROL,
      updated: metadata.updated,
      etag: metadata.etag,
    });
  } catch (error) {
    if (error.code === 404) {
      return res.status(404).json({
        error: 'Image not found.',
        code: 'IMAGE_NOT_FOUND',
      });
    }
    logger.error('Error fetching image info:', error);
    return res.status(500).json({
      error: 'Failed to retrieve image information.',
      code: 'FETCH_FAILED',
    });
  }
};

module.exports = {
  uploadProductImage,
  uploadProductImages,
  deleteProductImage,
  attachImageToProduct,
  getImageInfo,
};
