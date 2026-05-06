/**
 * Upload Validation Middleware
 * Additional validation layer for file uploads beyond Multer's built-in checks.
 * Validates file signatures (magic bytes) to prevent MIME type spoofing.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

/**
 * Magic byte signatures for allowed image types
 * Used to validate actual file content, not just MIME type headers
 */
const FILE_SIGNATURES = {
  jpeg: [
    [0xff, 0xd8, 0xff], // JPEG
  ],
  png: [
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG
  ],
  gif: [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  ],
  webp: [
    [0x52, 0x49, 0x46, 0x46], // RIFF (WebP starts with RIFF)
  ],
};

/**
 * Read the first N bytes of a file to check its signature
 * @param {string} filePath - Path to the file
 * @param {number} numBytes - Number of bytes to read
 * @returns {Promise<Buffer>} File header bytes
 */
const readFileHeader = (filePath, numBytes = 12) => {
  return new Promise((resolve, reject) => {
    const buffer = Buffer.alloc(numBytes);
    fs.open(filePath, 'r', (err, fd) => {
      if (err) return reject(err);
      fs.read(fd, buffer, 0, numBytes, 0, (readErr, bytesRead) => {
        fs.close(fd, () => {});
        if (readErr) return reject(readErr);
        resolve(buffer.slice(0, bytesRead));
      });
    });
  });
};

/**
 * Check if a buffer starts with a given byte signature
 * @param {Buffer} buffer - File header bytes
 * @param {number[]} signature - Expected byte signature
 * @returns {boolean}
 */
const matchesSignature = (buffer, signature) => {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
};

/**
 * Validate that an uploaded file's content matches its declared MIME type
 * @param {string} filePath - Path to the uploaded file
 * @param {string} mimetype - Declared MIME type
 * @returns {Promise<boolean>} True if valid, false otherwise
 */
const validateFileSignature = async (filePath, mimetype) => {
  try {
    const header = await readFileHeader(filePath);

    if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') {
      return FILE_SIGNATURES.jpeg.some((sig) => matchesSignature(header, sig));
    }
    if (mimetype === 'image/png') {
      return FILE_SIGNATURES.png.some((sig) => matchesSignature(header, sig));
    }
    if (mimetype === 'image/gif') {
      return FILE_SIGNATURES.gif.some((sig) => matchesSignature(header, sig));
    }
    if (mimetype === 'image/webp') {
      // WebP: RIFF....WEBP
      if (!FILE_SIGNATURES.webp.some((sig) => matchesSignature(header, sig))) {
        return false;
      }
      // Check for WEBP marker at bytes 8-11
      const webpMarker = header.slice(8, 12).toString('ascii');
      return webpMarker === 'WEBP';
    }

    return false;
  } catch (error) {
    logger.error('Error validating file signature:', error);
    return false;
  }
};

/**
 * Middleware to validate uploaded file signatures after Multer processing
 * Deletes invalid files and returns 400 error
 */
const validateUploadedFile = async (req, res, next) => {
  try {
    const file = req.file;
    if (!file) {
      return next(); // No file to validate, let controller handle it
    }

    const isValid = await validateFileSignature(file.path, file.mimetype);

    if (!isValid) {
      // Delete the invalid file
      fs.unlink(file.path, (err) => {
        if (err) logger.error('Failed to delete invalid file:', err);
      });

      return res.status(400).json({
        error:
          'Invalid file content. The file does not match its declared type.',
        code: 'INVALID_FILE_CONTENT',
      });
    }

    next();
  } catch (error) {
    logger.error('Error in upload validation middleware:', error);
    next(error);
  }
};

/**
 * Middleware to validate multiple uploaded files after Multer processing
 * Deletes all files if any are invalid
 */
const validateUploadedFiles = async (req, res, next) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return next(); // No files to validate
    }

    const validationResults = await Promise.all(
      files.map(async (file) => ({
        file,
        isValid: await validateFileSignature(file.path, file.mimetype),
      }))
    );

    const invalidFiles = validationResults.filter((r) => !r.isValid);

    if (invalidFiles.length > 0) {
      // Delete all uploaded files on validation failure
      await Promise.all(
        files.map(
          (file) =>
            new Promise((resolve) => {
              fs.unlink(file.path, (err) => {
                if (err) logger.error('Failed to delete invalid file:', err);
                resolve();
              });
            })
        )
      );

      return res.status(400).json({
        error: `${invalidFiles.length} file(s) have invalid content. All uploads rejected.`,
        code: 'INVALID_FILE_CONTENT',
        invalidFiles: invalidFiles.map((r) => r.file.originalname),
      });
    }

    next();
  } catch (error) {
    logger.error('Error in upload files validation middleware:', error);
    next(error);
  }
};

module.exports = {
  validateUploadedFile,
  validateUploadedFiles,
  validateFileSignature,
};
