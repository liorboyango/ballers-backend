/**
 * Validation Middleware
 * Provides reusable Joi-based request validation helpers.
 * Used by route handlers to validate request body, query, and params.
 */

const Joi = require('joi');

/**
 * Creates an Express middleware that validates req.body against a Joi schema.
 *
 * @param {Joi.Schema} schema - Joi schema to validate against
 * @returns {import('express').RequestHandler}
 *
 * @example
 * router.post('/register', validateBody(registerSchema), authCtrl.register);
 */
function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed.',
        details: error.details.map((d) => ({
          field: d.path.join('.'),
          message: d.message,
        })),
      });
    }

    // Replace body with validated & sanitized value
    req.body = value;
    next();
  };
}

/**
 * Creates an Express middleware that validates req.query against a Joi schema.
 *
 * @param {Joi.Schema} schema - Joi schema to validate against
 * @returns {import('express').RequestHandler}
 */
function validateQuery(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid query parameters.',
        details: error.details.map((d) => ({
          field: d.path.join('.'),
          message: d.message,
        })),
      });
    }

    req.query = value;
    next();
  };
}

/**
 * Creates an Express middleware that validates req.params against a Joi schema.
 *
 * @param {Joi.Schema} schema - Joi schema to validate against
 * @returns {import('express').RequestHandler}
 */
function validateParams(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Invalid path parameters.',
        details: error.details.map((d) => ({
          field: d.path.join('.'),
          message: d.message,
        })),
      });
    }

    req.params = value;
    next();
  };
}

/**
 * Common Joi schemas for reuse across routes.
 */
const commonSchemas = {
  /** MongoDB ObjectId string */
  objectId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .messages({
      'string.pattern.base': '{{#label}} must be a valid MongoDB ObjectId.',
    }),

  /** Pagination query params */
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

module.exports = {
  validateBody,
  validateQuery,
  validateParams,
  commonSchemas,
};
