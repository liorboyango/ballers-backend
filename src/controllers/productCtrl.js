/**
 * Product Controller
 * Handles CRUD operations for products (soccer kits).
 * Public endpoints: list, get by ID.
 * Protected endpoints: create, update, delete (admin only).
 */
const Product = require('../models/Product');
const Team = require('../models/Team');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');
const { PAGINATION } = require('../utils/constants');

/**
 * GET /api/products
 * List products with optional filtering, sorting, and pagination
 * @query {string} [teamId] - Filter by team MongoDB ObjectId
 * @query {string} [kitType] - Filter by kit type (home/away/third/goalkeeper)
 * @query {number} [minPrice] - Minimum price filter
 * @query {number} [maxPrice] - Maximum price filter
 * @query {string} [size] - Filter by available size
 * @query {string} [search] - Text search on name/description
 * @query {number} [page=1] - Page number
 * @query {number} [limit=20] - Items per page
 * @query {string} [sort] - Sort field (prefix with - for descending)
 */
exports.getProducts = asyncHandler(async (req, res, next) => {
  const {
    teamId,
    kitType,
    minPrice,
    maxPrice,
    size,
    search,
    page = PAGINATION.DEFAULT_PAGE,
    limit = PAGINATION.DEFAULT_LIMIT,
    sort,
  } = req.query;

  // Build filter object
  const filter = {};

  if (teamId) filter.team = teamId;
  if (kitType) filter.kitType = kitType;
  if (size) filter.sizes = { $in: [size] };

  if (minPrice !== undefined || maxPrice !== undefined) {
    filter.price = {};
    if (minPrice !== undefined) filter.price.$gte = Number(minPrice);
    if (maxPrice !== undefined) filter.price.$lte = Number(maxPrice);
  }

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }

  // Build sort object
  let sortObj = { createdAt: -1 }; // Default: newest first
  if (sort) {
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    const sortOrder = sort.startsWith('-') ? -1 : 1;
    sortObj = { [sortField]: sortOrder };
  }

  // Pagination
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  // Execute query with population
  const [products, total] = await Promise.all([
    Product.find(filter)
      .populate('team', 'name country flagUrl')
      .sort(sortObj)
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Product.countDocuments(filter),
  ]);

  res.status(200).json({
    status: 'success',
    results: products.length,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      hasNextPage: pageNum < Math.ceil(total / limitNum),
      hasPrevPage: pageNum > 1,
    },
    data: products,
  });
});

/**
 * GET /api/products/:id
 * Get a single product by ID
 * @param {string} id - MongoDB ObjectId of the product
 */
exports.getProductById = asyncHandler(async (req, res, next) => {
  const product = await Product.findById(req.params.id)
    .populate('team', 'name country flagUrl group')
    .lean();

  if (!product) {
    return next(new AppError('Product not found.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: product,
  });
});

/**
 * POST /api/products
 * Create a new product (admin only)
 * Requires multipart/form-data for image upload
 * @body {string} name - Product name
 * @body {number} price - Product price
 * @body {string} teamId - Team MongoDB ObjectId
 * @body {string} kitType - Kit type (home/away/third/goalkeeper)
 * @body {string[]} sizes - Available sizes array
 * @file {File} [image] - Product image (max 5MB, JPEG/PNG/WebP)
 */
exports.createProduct = asyncHandler(async (req, res, next) => {
  // Verify team exists
  const team = await Team.findById(req.body.teamId);
  if (!team) {
    return next(new AppError('Team not found. Please provide a valid teamId.', 404));
  }

  // Build product data
  const productData = {
    ...req.body,
    team: req.body.teamId,
  };
  delete productData.teamId;

  // Attach uploaded image URL if present
  if (req.file) {
    productData.imageUrl = `/uploads/${req.file.filename}`;
  }

  const product = await Product.create(productData);
  await product.populate('team', 'name country flagUrl');

  logger.info(`Product created: ${product.name} (${product._id})`);

  res.status(201).json({
    status: 'success',
    message: 'Product created successfully.',
    data: product,
  });
});

/**
 * PUT /api/products/:id
 * Update an existing product (admin only)
 * @param {string} id - MongoDB ObjectId of the product
 */
exports.updateProduct = asyncHandler(async (req, res, next) => {
  const updateData = { ...req.body };

  // Handle teamId -> team field mapping
  if (updateData.teamId) {
    const team = await Team.findById(updateData.teamId);
    if (!team) {
      return next(new AppError('Team not found. Please provide a valid teamId.', 404));
    }
    updateData.team = updateData.teamId;
    delete updateData.teamId;
  }

  // Attach new image if uploaded
  if (req.file) {
    updateData.imageUrl = `/uploads/${req.file.filename}`;
  }

  const product = await Product.findByIdAndUpdate(
    req.params.id,
    updateData,
    { new: true, runValidators: true }
  ).populate('team', 'name country flagUrl');

  if (!product) {
    return next(new AppError('Product not found.', 404));
  }

  logger.info(`Product updated: ${product._id}`);

  res.status(200).json({
    status: 'success',
    message: 'Product updated successfully.',
    data: product,
  });
});

/**
 * DELETE /api/products/:id
 * Delete a product (admin only)
 * @param {string} id - MongoDB ObjectId of the product
 */
exports.deleteProduct = asyncHandler(async (req, res, next) => {
  const product = await Product.findByIdAndDelete(req.params.id);

  if (!product) {
    return next(new AppError('Product not found.', 404));
  }

  logger.info(`Product deleted: ${req.params.id}`);

  res.status(204).json({
    status: 'success',
    message: 'Product deleted successfully.',
    data: null,
  });
});
