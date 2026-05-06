/**
 * Products Router
 * Handles all /api/products routes.
 *
 * Public endpoints (no auth required):
 *   GET /api/products           - List products with optional filtering & pagination
 *   GET /api/products/:id       - Get a single product by ID
 *
 * Protected endpoints (require JWT auth - implemented in later tasks):
 *   POST   /api/products        - Create a new product (admin)
 *   PUT    /api/products/:id    - Update a product (admin)
 *   DELETE /api/products/:id    - Delete a product (admin)
 */

const express = require('express');
const Joi = require('joi');
const { getProducts, getProductById } = require('../../controllers/productCtrl');

const router = express.Router();

/**
 * Joi validation schema for GET /api/products query parameters.
 */
const productsQuerySchema = Joi.object({
  teamId: Joi.string()
    .pattern(/^[0-9a-fA-F]{24}$/)
    .optional()
    .messages({
      'string.pattern.base': 'teamId must be a valid MongoDB ObjectId.',
    }),
  kitType: Joi.string().valid('home', 'away', 'third').optional(),
  size: Joi.string().valid('XS', 'S', 'M', 'L', 'XL', 'XXL').optional(),
  minPrice: Joi.number().min(0).optional(),
  maxPrice: Joi.number().min(0).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(12),
  sort: Joi.string()
    .valid(
      'name',
      '-name',
      'price',
      '-price',
      'createdAt',
      '-createdAt',
      'kitType',
      '-kitType'
    )
    .default('-createdAt'),
  search: Joi.string().max(100).optional(),
  inStock: Joi.string().valid('true', 'false').optional(),
});

/**
 * Middleware: validate query params for listing products.
 */
function validateProductsQuery(req, res, next) {
  const { error, value } = productsQuerySchema.validate(req.query, { abortEarly: false });
  if (error) {
    return res.status(400).json({
      success: false,
      error: 'Invalid query parameters.',
      details: error.details.map((d) => d.message),
    });
  }
  req.query = value;
  next();
}

/**
 * GET /api/products
 * List products with optional filtering, pagination, and sorting.
 *
 * Query params:
 *   - teamId    {string}  Filter by team ObjectId
 *   - kitType   {string}  Filter by kit type: home | away | third
 *   - size      {string}  Filter by available size: XS | S | M | L | XL | XXL
 *   - minPrice  {number}  Minimum price filter
 *   - maxPrice  {number}  Maximum price filter
 *   - page      {number}  Page number (default: 1)
 *   - limit     {number}  Items per page (default: 12, max: 100)
 *   - sort      {string}  Sort field (name, price, createdAt, kitType; prefix '-' for desc)
 *   - search    {string}  Text search on name/description
 *   - inStock   {string}  'true' to show only in-stock items
 *
 * Response 200:
 * {
 *   success: true,
 *   data: Product[],
 *   pagination: { total, page, limit, totalPages, hasNextPage, hasPrevPage }
 * }
 */
router.get('/', validateProductsQuery, getProducts);

/**
 * GET /api/products/:id
 * Get a single product by MongoDB ObjectId.
 * Populates team info (name, country, flag, group).
 *
 * Response 200:
 * {
 *   success: true,
 *   data: Product (with populated team)
 * }
 *
 * Response 400: Invalid ID format
 * Response 404: Product not found
 */
router.get('/:id', getProductById);

module.exports = router;
