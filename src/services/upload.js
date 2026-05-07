/**
 * File upload service.
 * Multer collects the file in-memory (no local disk writes); the buffer is
 * then streamed to Firebase Storage and the controller stores the resulting
 * public URL on the product document.
 *
 * Also exposes `downloadAndUploadImages()` for bulk-importing images from
 * external URLs (e.g. Yupoo). Each URL is fetched as an arraybuffer, validated
 * (MIME type + size), uploaded to Firebase Storage, and the resulting public
 * URL is returned.
 */
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { admin } = require('./db');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { UPLOAD_LIMITS } = require('../utils/constants');

/**
 * Cache-Control value applied to every image stored in Firebase Storage.
 * - public        : may be cached by any cache (browser, CDN, proxy)
 * - max-age=31536000 : cache for 1 year (images are content-addressed UUIDs)
 * - immutable     : tells CDN/browser the resource will never change at this URL
 *
 * Exported so controllers can echo the same value in HTTP response headers.
 */
const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * Maximum size allowed for externally downloaded images (5 MB).
 * This matches the multer upload limit for consistency.
 */
const MAX_EXTERNAL_IMAGE_SIZE = UPLOAD_LIMITS.MAX_FILE_SIZE; // 5MB

/**
 * Allowed MIME types for externally downloaded images.
 */
const ALLOWED_EXTERNAL_MIME_TYPES = UPLOAD_LIMITS.ALLOWED_MIME_TYPES;

const fileFilter = (req, file, cb) => {
  if (UPLOAD_LIMITS.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new AppError(
        `Invalid file type. Only JPEG, PNG, and WebP images are allowed. Received: ${file.mimetype}`,
        400
      ),
      false
    );
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: UPLOAD_LIMITS.MAX_FILE_SIZE,
    files: 10,
  },
});

const getBucket = () => admin.storage().bucket();

/**
 * Streams a file buffer to Firebase Storage under products/<uuid><ext> and
 * returns a publicly readable URL. The product document stores this URL.
 */
const uploadProductImage = async ({ buffer, mimetype, originalname }) => {
  const ext = path.extname(originalname || '').toLowerCase() || '';
  return uploadProductImageBuffer({ buffer, mimetype, ext });
};

/**
 * Lower-level variant: upload a raw buffer with an explicit ext (e.g. from an
 * AI-generated image where there's no original filename). Returns the public URL.
 *
 * Sets cacheControl to IMAGE_CACHE_CONTROL so Firebase Storage serves the
 * correct Cache-Control header to browsers and CDN edge nodes.
 */
const uploadProductImageBuffer = async ({ buffer, mimetype, ext = '' }) => {
  const objectName = `products/${crypto.randomUUID()}${ext}`;
  const file = getBucket().file(objectName);

  await file.save(buffer, {
    contentType: mimetype,
    resumable: false,
    metadata: { cacheControl: IMAGE_CACHE_CONTROL },
  });
  await file.makePublic();

  return `https://storage.googleapis.com/${getBucket().name}/${objectName}`;
};

/**
 * Downloads images from external URLs, validates them, and uploads each one
 * to Firebase Storage. Returns an array of public storage URLs.
 *
 * Each image is:
 *  1. Fetched via axios (arraybuffer)
 *  2. Validated: MIME type must be image/*, size must be < MAX_EXTERNAL_IMAGE_SIZE
 *  3. Uploaded to Firebase Storage via uploadProductImageBuffer
 *
 * On individual image failure the error is logged and that image is skipped
 * (non-fatal). If ALL images fail, a single AppError(422) is thrown.
 *
 * @param {string[]} imageUrls - Array of external image URLs to download and upload
 * @param {object}  [opts]
 * @param {number}  [opts.maxImages=10]        - Maximum number of images to process
 * @param {number}  [opts.timeoutMs=15000]     - Per-request timeout in milliseconds
 * @returns {Promise<string[]>} Array of Firebase Storage public URLs
 */
const downloadAndUploadImages = async (imageUrls, opts = {}) => {
  const { maxImages = 10, timeoutMs = 15000 } = opts;
  const urls = Array.isArray(imageUrls) ? imageUrls.slice(0, maxImages) : [];

  if (urls.length === 0) return [];

  const results = [];

  for (const url of urls) {
    try {
      logger.info(`Downloading external image: ${url}`);

      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: timeoutMs,
        maxContentLength: MAX_EXTERNAL_IMAGE_SIZE,
        maxBodyLength: MAX_EXTERNAL_IMAGE_SIZE,
        headers: {
          // Mimic a browser user-agent to avoid simple bot-blocking
          'User-Agent':
            'Mozilla/5.0 (compatible; BallersBot/1.0; +https://ballers.app)',
          Accept: 'image/*,*/*;q=0.8',
        },
        validateStatus: (status) => status >= 200 && status < 300,
      });

      // Derive MIME type from Content-Type header
      const contentType = (response.headers['content-type'] || '').split(';')[0].trim();
      const mimeType = contentType || 'image/jpeg';

      // Validate MIME type — must be an image
      if (!mimeType.startsWith('image/')) {
        logger.warn(
          `Skipping external URL (non-image MIME "${mimeType}"): ${url}`
        );
        continue;
      }

      // Validate that it's one of our explicitly allowed types
      const isAllowedMime = ALLOWED_EXTERNAL_MIME_TYPES.includes(mimeType) ||
        mimeType === 'image/jpg';
      if (!isAllowedMime) {
        // Accept common image types even if not in the strict upload list
        // (e.g. image/gif, image/bmp) — convert to a generic image/jpeg label
        logger.warn(
          `External image MIME type "${mimeType}" is not in the strict allowlist; ` +
          `proceeding as image/jpeg for: ${url}`
        );
      }

      const buffer = Buffer.from(response.data);

      // Size guard (belt-and-suspenders after maxContentLength)
      if (buffer.length > MAX_EXTERNAL_IMAGE_SIZE) {
        logger.warn(
          `Skipping external image (${buffer.length} bytes > ${MAX_EXTERNAL_IMAGE_SIZE} limit): ${url}`
        );
        continue;
      }

      // Determine file extension from MIME or URL
      let ext = '';
      const urlPath = new URL(url).pathname;
      const urlExt = path.extname(urlPath).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(urlExt)) {
        ext = urlExt === '.jpeg' ? '.jpg' : urlExt;
      } else {
        ext = mimeType === 'image/png' ? '.png'
          : mimeType === 'image/webp' ? '.webp'
          : '.jpg';
      }

      const normalizedMime = ALLOWED_EXTERNAL_MIME_TYPES.includes(mimeType)
        ? mimeType
        : 'image/jpeg';

      const storageUrl = await uploadProductImageBuffer({
        buffer,
        mimetype: normalizedMime,
        ext,
      });

      logger.info(`Successfully uploaded external image to: ${storageUrl}`);
      results.push(storageUrl);
    } catch (err) {
      logger.warn(
        `Failed to download/upload external image "${url}": ${err.message}`
      );
      // Continue to next image rather than failing the whole batch
    }
  }

  if (results.length === 0 && urls.length > 0) {
    throw new AppError(
      `Failed to download/upload any of the ${urls.length} provided image URLs. ` +
      'Please verify that the URLs are publicly accessible image files.',
      422
    );
  }

  return results;
};

/**
 * Best-effort deletion of a previously stored image. Accepts the public URL
 * we wrote in `uploadProductImage`. Does not throw if the file is missing.
 */
const deleteProductImage = async (publicUrl) => {
  if (!publicUrl) return;
  const bucket = getBucket();
  const prefix = `https://storage.googleapis.com/${bucket.name}/`;
  if (!publicUrl.startsWith(prefix)) return;
  const objectName = publicUrl.slice(prefix.length);
  try {
    await bucket.file(objectName).delete();
  } catch (err) {
    logger.warn(`Failed to delete storage object ${objectName}: ${err.message}`);
  }
};

/**
 * Best-effort deletion of all product images (storage URLs array).
 * Used during cleanup of failed bulk imports.
 *
 * @param {string[]} urls - Array of storage public URLs to delete
 */
const deleteProductImages = async (urls) => {
  if (!Array.isArray(urls) || urls.length === 0) return;
  await Promise.allSettled(urls.map(deleteProductImage));
};

module.exports = {
  upload,
  uploadProductImage,
  uploadProductImageBuffer,
  downloadAndUploadImages,
  deleteProductImage,
  deleteProductImages,
  IMAGE_CACHE_CONTROL,
};
