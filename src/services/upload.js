/**
 * File Upload Service
 * Configures Multer for handling product image uploads.
 * Validates file type (JPEG/PNG/WebP only) and size (max 5MB).
 * Files are stored in /uploads directory with unique filenames.
 */
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AppError = require('../utils/AppError');
const { UPLOAD_LIMITS } = require('../utils/constants');

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

/**
 * Multer disk storage configuration
 * Files are saved to /uploads with timestamp-based unique names
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp-randomhex.ext
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `product-${uniqueSuffix}${ext}`);
  },
});

/**
 * File type filter - only allow image files
 * @param {Object} req - Express request
 * @param {Object} file - Multer file object
 * @param {Function} cb - Callback
 */
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

/**
 * Configured Multer instance
 * - Max file size: 5MB
 * - Allowed types: JPEG, PNG, WebP
 * - Storage: disk (/uploads directory)
 */
exports.upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: UPLOAD_LIMITS.MAX_FILE_SIZE,
    files: 1, // Only one file per request
  },
});
