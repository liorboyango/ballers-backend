/**
 * File Upload Service
 *
 * Configures Multer for handling product image uploads.
 * Stores files to /uploads directory with unique filenames.
 * Validates file type and size.
 */

'use strict';

const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { UPLOAD } = require('../utils/constants');
const logger = require('../utils/logger');

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), UPLOAD.DEST);
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  logger.info(`Created uploads directory: ${uploadsDir}`);
}

/**
 * Multer disk storage configuration.
 * Files are saved to /uploads with UUID-based filenames
 * to prevent collisions and path traversal attacks.
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${uuidv4()}${ext}`;
    cb(null, uniqueName);
  },
});

/**
 * File filter to validate MIME types.
 * Only allows image files defined in UPLOAD.ALLOWED_MIME_TYPES.
 *
 * @param {import('express').Request} req
 * @param {Express.Multer.File} file
 * @param {multer.FileFilterCallback} cb
 */
function fileFilter(req, file, cb) {
  if (UPLOAD.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid file type: ${file.mimetype}. Allowed types: ${UPLOAD.ALLOWED_MIME_TYPES.join(', ')}`
      ),
      false
    );
  }
}

/**
 * Configured Multer instance for single product image uploads.
 * Use as middleware: upload.single('image')
 */
const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: UPLOAD.MAX_FILE_SIZE,
    files: 1,
  },
});

/**
 * Multer error handler middleware.
 * Converts Multer-specific errors to consistent API error responses.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: `File too large. Maximum size is ${UPLOAD.MAX_FILE_SIZE / (1024 * 1024)}MB.`,
      });
    }
    return res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`,
    });
  }

  if (err && err.message && err.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }

  next(err);
}

module.exports = { upload, handleUploadError };
