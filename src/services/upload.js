/**
 * Upload Service
 * Configures Multer for handling product image file uploads.
 * Supports disk storage with validation for image MIME types and file size.
 */

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, '../../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Allowed image MIME types
 */
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
];

/**
 * Maximum file size: 5MB
 */
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB in bytes

/**
 * Disk storage configuration
 * Files are stored in /uploads with UUID-based filenames to prevent collisions
 */
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // Generate unique filename: uuid + original extension
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueFilename = `${uuidv4()}${ext}`;
    cb(null, uniqueFilename);
  },
});

/**
 * File filter to validate MIME types
 * Rejects files that are not valid image types
 */
const imageFileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new multer.MulterError(
        'LIMIT_UNEXPECTED_FILE',
        `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`
      ),
      false
    );
  }
};

/**
 * Multer instance for single product image upload
 * Field name: 'image'
 */
const uploadSingleImage = multer({
  storage: diskStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
}).single('image');

/**
 * Multer instance for multiple product images upload
 * Field name: 'images', max 10 files
 */
const uploadMultipleImages = multer({
  storage: diskStorage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 10,
  },
}).array('images', 10);

/**
 * Middleware wrapper for single image upload with error handling
 */
const handleSingleImageUpload = (req, res, next) => {
  uploadSingleImage(req, res, (err) => {
    if (err) {
      return handleMulterError(err, res);
    }
    next();
  });
};

/**
 * Middleware wrapper for multiple images upload with error handling
 */
const handleMultipleImagesUpload = (req, res, next) => {
  uploadMultipleImages(req, res, (err) => {
    if (err) {
      return handleMulterError(err, res);
    }
    next();
  });
};

/**
 * Handle Multer-specific errors with appropriate HTTP responses
 * @param {Error} err - Multer error
 * @param {Object} res - Express response object
 */
const handleMulterError = (err, res) => {
  if (err instanceof multer.MulterError) {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`,
          code: 'FILE_TOO_LARGE',
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          error: 'Too many files uploaded.',
          code: 'TOO_MANY_FILES',
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          error: err.message || 'Unexpected file field.',
          code: 'INVALID_FILE_TYPE',
        });
      default:
        return res.status(400).json({
          error: `Upload error: ${err.message}`,
          code: 'UPLOAD_ERROR',
        });
    }
  }
  // Non-Multer error
  return res.status(500).json({
    error: 'An unexpected error occurred during file upload.',
    code: 'INTERNAL_ERROR',
  });
};

/**
 * Delete a file from the uploads directory
 * @param {string} filename - Name of the file to delete
 * @returns {Promise<void>}
 */
const deleteUploadedFile = (filename) => {
  return new Promise((resolve, reject) => {
    const filePath = path.join(UPLOADS_DIR, filename);
    fs.unlink(filePath, (err) => {
      if (err) {
        if (err.code === 'ENOENT') {
          // File doesn't exist, consider it already deleted
          resolve();
        } else {
          reject(err);
        }
      } else {
        resolve();
      }
    });
  });
};

/**
 * Get the public URL path for an uploaded file
 * @param {string} filename - Name of the uploaded file
 * @returns {string} Public URL path
 */
const getFileUrl = (filename) => {
  return `/uploads/${filename}`;
};

module.exports = {
  handleSingleImageUpload,
  handleMultipleImagesUpload,
  deleteUploadedFile,
  getFileUrl,
  UPLOADS_DIR,
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
};
