/**
 * Request Validation Middleware
 *
 * Provides Joi-based validation middleware factory for
 * validating request body, query parameters, and URL params.
 */

'use strict';

const Joi = require('joi');
const logger = require('../utils/logger');

/**
 * Validation middleware factory.
 * Creates an Express middleware that validates the specified
 * part of the request against a Joi schema.
 *
 * @param {Joi.Schema} schema - The Joi validation schema
 * @param {'body'|'query'|'params'} [target='body'] - Which part of the request to validate
 * @returns {import('express').RequestHandler}
 *
 * @example
 * const schema = Joi.object({ email: Joi.string().email().required() });
 * router.post('/login', validate(schema), loginController);
 */
function validate(schema, target = 'body') {
  return (req, res, next) => {
    const data = req[target];

    const { error, value } = schema.validate(data, {
      abortEarly: false, // Return all validation errors, not just the first
      stripUnknown: true, // Remove unknown fields from the validated value
      convert: true, // Allow type coercion (e.g., string '5' -> number 5)
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message.replace(/"/g, "'"),
      }));

      logger.debug(`Validation failed for ${req.method} ${req.originalUrl}:`, errors);

      return res.status(400).json({
        success: false,
        error: 'Validation failed.',
        errors,
      });
    }

    // Replace the request data with the validated (and sanitized) value
    req[target] = value;
    next();
  };
}

/**
 * Validate MongoDB ObjectId parameter.
 * Rejects requests with invalid ObjectId formats early.
 *
 * @param {string} paramName - The URL parameter name to validate
 * @returns {import('express').RequestHandler}
 *
 * @example
 * router.get('/:id', validateObjectId('id'), getProduct);
 */
function validateObjectId(paramName) {
  return (req, res, next) => {
    const id = req.params[paramName];
    const objectIdRegex = /^[a-fA-F0-9]{24}$/;

    if (!objectIdRegex.test(id)) {
      return res.status(400).json({
        success: false,
        error: `Invalid ID format for parameter '${paramName}'.`,
      });
    }

    next();
  };
}

/**
 * Pagination validation middleware.
 * Validates and normalizes ?page and ?limit query parameters.
 * Attaches normalized pagination to req.pagination.
 *
 * @param {object} [options]
 * @param {number} [options.defaultLimit=20] - Default items per page
 * @param {number} [options.maxLimit=100] - Maximum allowed items per page
 * @returns {import('express').RequestHandler}
 */
function validatePagination({ defaultLimit = 20, maxLimit = 100 } = {}) {
  const schema = Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(maxLimit).default(defaultLimit),
  }).unknown(true); // Allow other query params

  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, { convert: true });

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid pagination parameters.',
        errors: error.details.map((d) => ({ field: d.path.join('.'), message: d.message })),
      });
    }

    req.pagination = {
      page: value.page,
      limit: value.limit,
      skip: (value.page - 1) * value.limit,
    };

    next();
  };
}

module.exports = { validate, validateObjectId, validatePagination };
