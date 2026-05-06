/**
 * Input Sanitization Utilities
 * Provides functions to sanitize user input and prevent XSS attacks.
 * Used as middleware and in controllers before processing data.
 */

/**
 * Strips HTML tags and dangerous characters from a string
 * @param {string} str - Input string to sanitize
 * @returns {string} Sanitized string
 */
const stripHtml = (str) => {
  if (typeof str !== 'string') return str;
  return str
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+\s*=/gi, '') // Remove event handlers
    .trim();
};

/**
 * Recursively sanitizes all string values in an object
 * @param {*} obj - Object, array, or primitive to sanitize
 * @returns {*} Sanitized value
 */
const sanitizeObject = (obj) => {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return stripHtml(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  if (typeof obj === 'object') {
    const sanitized = {};
    for (const key of Object.keys(obj)) {
      // Sanitize key names too (prevent prototype pollution)
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      sanitized[key] = sanitizeObject(obj[key]);
    }
    return sanitized;
  }

  return obj;
};

/**
 * Express middleware to sanitize request body, query, and params
 * Applies XSS protection to all incoming string data
 */
const sanitizeInput = (req, res, next) => {
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }
  next();
};

/**
 * Validates that a string is a valid MongoDB ObjectId
 * @param {string} id - ID string to validate
 * @returns {boolean} True if valid ObjectId format
 */
const isValidObjectId = (id) => {
  return /^[a-fA-F0-9]{24}$/.test(id);
};

module.exports = { stripHtml, sanitizeObject, sanitizeInput, isValidObjectId };
