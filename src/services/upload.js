/**
 * Multer configuration for product image uploads.
 * Stores files to /uploads directory, validates mime type and size.
 */

const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE, 10) || 5 * 1024 * 1024; // 5 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', '..', 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(`Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`),
      false
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
});

module.exports = upload;
