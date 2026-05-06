/**
 * Joi validation middleware factory.
 * Usage: router.post('/route', validate(schema), controller)
 */

const Joi = require('joi');

/**
 * Creates an Express middleware that validates req.body against a Joi schema.
 * @param {Joi.Schema} schema - Joi validation schema
 * @returns {Function} Express middleware
 */
const validate = (schema) => (req, res, next) => {
  const { error, value } = schema.validate(req.body, {
    abortEarly: false,
    stripUnknown: true,
  });

  if (error) {
    const details = error.details.map((d) => d.message);
    return res.status(400).json({ error: 'Validation failed', details });
  }

  req.body = value; // use sanitized value
  next();
};

module.exports = { validate };
