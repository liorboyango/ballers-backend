/**
 * Validation Middleware
 * Uses Joi schemas to validate request body, query parameters, and URL params.
 * Returns structured 422 errors with field-level details on validation failure.
 */
const Joi = require('joi');
const AppError = require('../utils/AppError');

/**
 * Creates a validation middleware for the specified request property
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {'body'|'query'|'params'} property - Request property to validate
 * @returns {Function} Express middleware function
 */
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false, // Collect ALL validation errors, not just the first
      allowUnknown: false, // Reject unknown fields
      stripUnknown: true, // Remove unknown fields from validated value
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message.replace(/"/g, ''), // Remove Joi's quote wrapping
      }));

      return next(
        new AppError('Validation failed. Please check the provided data.', 422, errors)
      );
    }

    // Replace request property with validated (and stripped) value
    req[property] = value;
    next();
  };
};

// ─────────────────────────────────────────────
// AUTH SCHEMAS
// ─────────────────────────────────────────────

/**
 * Schema for POST /api/auth/register
 */
const registerSchema = Joi.object({
  name: Joi.string().min(2).max(50).trim().required().messages({
    'string.min': 'Name must be at least 2 characters long',
    'string.max': 'Name cannot exceed 50 characters',
    'any.required': 'Name is required',
  }),
  email: Joi.string().email().lowercase().trim().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string()
    .min(8)
    .max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'password complexity')
    .required()
    .messages({
      'string.min': 'Password must be at least 8 characters long',
      'string.max': 'Password cannot exceed 128 characters',
      'string.pattern.name':
        'Password must contain at least one uppercase letter, one lowercase letter, and one number',
      'any.required': 'Password is required',
    }),
});

/**
 * Schema for POST /api/auth/login
 */
const loginSchema = Joi.object({
  email: Joi.string().email().lowercase().trim().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  password: Joi.string().required().messages({
    'any.required': 'Password is required',
  }),
});

// ─────────────────────────────────────────────
// PRODUCT SCHEMAS
// ─────────────────────────────────────────────

/**
 * Schema for POST /api/products (create product)
 */
const createProductSchema = Joi.object({
  name: Joi.string().min(2).max(100).trim().required().messages({
    'string.min': 'Product name must be at least 2 characters',
    'string.max': 'Product name cannot exceed 100 characters',
    'any.required': 'Product name is required',
  }),
  description: Joi.string().max(2000).trim().optional().allow(''),
  price: Joi.number().positive().precision(2).required().messages({
    'number.positive': 'Price must be a positive number',
    'any.required': 'Price is required',
  }),
  teamId: Joi.string()
    .pattern(/^[a-fA-F0-9]{24}$/)
    .required()
    .messages({
      'string.pattern.base': 'teamId must be a valid MongoDB ObjectId',
      'any.required': 'teamId is required',
    }),
  kitType: Joi.string().valid('home', 'away', 'third', 'goalkeeper').required().messages({
    'any.only': 'kitType must be one of: home, away, third, goalkeeper',
    'any.required': 'kitType is required',
  }),
  sizes: Joi.array()
    .items(Joi.string().valid('XS', 'S', 'M', 'L', 'XL', 'XXL'))
    .min(1)
    .required()
    .messages({
      'array.min': 'At least one size must be provided',
      'any.required': 'Sizes are required',
    }),
  stock: Joi.number().integer().min(0).default(0),
  customizable: Joi.boolean().default(true),
  sponsor: Joi.string().max(50).trim().optional().allow(''),
  season: Joi.string().max(20).trim().optional().allow(''),
  isNew: Joi.boolean().default(false),
  isFeatured: Joi.boolean().default(false),
});

/**
 * Schema for GET /api/products query parameters
 */
const getProductsQuerySchema = Joi.object({
  teamId: Joi.string()
    .pattern(/^[a-fA-F0-9]{24}$/)
    .optional()
    .messages({
      'string.pattern.base': 'teamId must be a valid MongoDB ObjectId',
    }),
  kitType: Joi.string().valid('home', 'away', 'third', 'goalkeeper').optional(),
  minPrice: Joi.number().min(0).optional(),
  maxPrice: Joi.number().min(0).optional(),
  size: Joi.string().valid('XS', 'S', 'M', 'L', 'XL', 'XXL').optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  sort: Joi.string().valid('price', '-price', 'name', '-name', 'createdAt', '-createdAt').optional(),
  search: Joi.string().max(100).trim().optional().allow(''),
});

/**
 * Schema for MongoDB ObjectId URL params
 */
const objectIdParamSchema = Joi.object({
  id: Joi.string()
    .pattern(/^[a-fA-F0-9]{24}$/)
    .required()
    .messages({
      'string.pattern.base': 'id must be a valid MongoDB ObjectId',
      'any.required': 'id parameter is required',
    }),
});

// ─────────────────────────────────────────────
// CART SCHEMAS
// ─────────────────────────────────────────────

/**
 * Reusable customization sub-schema
 */
const customizationSchema = Joi.object({
  playerName: Joi.string().max(20).trim().optional().allow('').messages({
    'string.max': 'Player name cannot exceed 20 characters',
  }),
  playerNumber: Joi.number().integer().min(1).max(99).optional().allow(null).messages({
    'number.min': 'Player number must be between 1 and 99',
    'number.max': 'Player number must be between 1 and 99',
  }),
  size: Joi.string().valid('XS', 'S', 'M', 'L', 'XL', 'XXL').required().messages({
    'any.only': 'Size must be one of: XS, S, M, L, XL, XXL',
    'any.required': 'Size is required',
  }),
});

/**
 * Schema for POST /api/cart/add
 */
const addToCartSchema = Joi.object({
  productId: Joi.string()
    .pattern(/^[a-fA-F0-9]{24}$/)
    .required()
    .messages({
      'string.pattern.base': 'productId must be a valid MongoDB ObjectId',
      'any.required': 'productId is required',
    }),
  quantity: Joi.number().integer().min(1).max(10).default(1).messages({
    'number.min': 'Quantity must be at least 1',
    'number.max': 'Maximum quantity per item is 10',
  }),
  customization: customizationSchema.required().messages({
    'any.required': 'Customization details (including size) are required',
  }),
});

/**
 * Schema for PUT /api/cart/update
 */
const updateCartSchema = Joi.object({
  itemId: Joi.string()
    .pattern(/^[a-fA-F0-9]{24}$/)
    .required()
    .messages({
      'string.pattern.base': 'itemId must be a valid MongoDB ObjectId',
      'any.required': 'itemId is required',
    }),
  quantity: Joi.number().integer().min(1).max(10).required().messages({
    'number.min': 'Quantity must be at least 1',
    'number.max': 'Maximum quantity per item is 10',
    'any.required': 'quantity is required',
  }),
});

/**
 * Schema for DELETE /api/cart/item query params
 */
const removeCartItemSchema = Joi.object({
  itemId: Joi.string()
    .pattern(/^[a-fA-F0-9]{24}$/)
    .required()
    .messages({
      'string.pattern.base': 'itemId must be a valid MongoDB ObjectId',
      'any.required': 'itemId query parameter is required',
    }),
});

// ─────────────────────────────────────────────
// ORDER SCHEMAS
// ─────────────────────────────────────────────

/**
 * Shipping address sub-schema
 */
const shippingAddressSchema = Joi.object({
  firstName: Joi.string().min(1).max(50).trim().required().messages({
    'any.required': 'First name is required',
    'string.max': 'First name cannot exceed 50 characters',
  }),
  lastName: Joi.string().min(1).max(50).trim().required().messages({
    'any.required': 'Last name is required',
    'string.max': 'Last name cannot exceed 50 characters',
  }),
  email: Joi.string().email().lowercase().trim().required().messages({
    'string.email': 'Please provide a valid email address',
    'any.required': 'Email is required',
  }),
  address: Joi.string().min(5).max(200).trim().required().messages({
    'string.min': 'Address must be at least 5 characters',
    'string.max': 'Address cannot exceed 200 characters',
    'any.required': 'Address is required',
  }),
  city: Joi.string().min(2).max(100).trim().required().messages({
    'string.min': 'City must be at least 2 characters',
    'any.required': 'City is required',
  }),
  postalCode: Joi.string()
    .pattern(/^[A-Z0-9\s\-]{3,10}$/i)
    .trim()
    .required()
    .messages({
      'string.pattern.base': 'Please provide a valid postal/ZIP code',
      'any.required': 'Postal code is required',
    }),
  country: Joi.string().min(2).max(100).trim().required().messages({
    'any.required': 'Country is required',
  }),
  phone: Joi.string()
    .pattern(/^[\+]?[\d\s\-\(\)]{7,20}$/)
    .optional()
    .allow('')
    .messages({
      'string.pattern.base': 'Please provide a valid phone number',
    }),
});

/**
 * Schema for POST /api/orders/create
 */
const createOrderSchema = Joi.object({
  shippingAddress: shippingAddressSchema.required().messages({
    'any.required': 'Shipping address is required',
  }),
  paymentMethod: Joi.string()
    .valid('card', 'paypal', 'stripe')
    .default('card')
    .messages({
      'any.only': 'Payment method must be one of: card, paypal, stripe',
    }),
  notes: Joi.string().max(500).trim().optional().allow('').messages({
    'string.max': 'Order notes cannot exceed 500 characters',
  }),
});

/**
 * Schema for GET /api/orders query parameters
 */
const getOrdersQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(50).default(10),
  status: Joi.string()
    .valid('pending', 'processing', 'shipped', 'delivered', 'cancelled')
    .optional(),
  sort: Joi.string().valid('createdAt', '-createdAt', 'total', '-total').optional(),
});

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  validate,
  schemas: {
    // Auth
    register: registerSchema,
    login: loginSchema,
    // Products
    createProduct: createProductSchema,
    getProductsQuery: getProductsQuerySchema,
    objectIdParam: objectIdParamSchema,
    // Cart
    addToCart: addToCartSchema,
    updateCart: updateCartSchema,
    removeCartItem: removeCartItemSchema,
    // Orders
    createOrder: createOrderSchema,
    getOrdersQuery: getOrdersQuerySchema,
  },
};
