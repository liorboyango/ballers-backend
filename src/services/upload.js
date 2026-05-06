/**
 * File upload service.
 * Multer collects the file in-memory (no local disk writes); the buffer is
 * then streamed to Firebase Storage and the controller stores the resulting
 * public URL on the product document.
 */
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { admin } = require('./db');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { UPLOAD_LIMITS } = require('../utils/constants');

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
    files: 1,
  },
});

const getBucket = () => admin.storage().bucket();

/**
 * Streams a file buffer to Firebase Storage under products/<uuid><ext> and
 * returns a publicly readable URL. The product document stores this URL.
 */
const uploadProductImage = async ({ buffer, mimetype, originalname }) => {
  const ext = path.extname(originalname || '').toLowerCase() || '';
  const objectName = `products/${crypto.randomUUID()}${ext}`;
  const file = getBucket().file(objectName);

  await file.save(buffer, {
    contentType: mimetype,
    resumable: false,
    metadata: { cacheControl: 'public, max-age=31536000' },
  });
  await file.makePublic();

  return `https://storage.googleapis.com/${getBucket().name}/${objectName}`;
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

module.exports = { upload, uploadProductImage, deleteProductImage };
