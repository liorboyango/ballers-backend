/**
 * Product Controller
 * Handles CRUD operations for products including image upload support.
 */

const Product = require('../models/Product');
const { getFileUrl, deleteUploadedFile } = require('../services/upload');
const logger = require('../utils/logger');
const path = require('path');

/**
 * Get all products with optional filtering and pagination
 * GET /api/products
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
const getProducts = async (req, res) => {
  try {
    const { teamId, category, minPrice, maxPrice, page = 1, limit = 20 } = req.query;

    // Build filter query
    const filter = {};
    if (teamId) filter.teamId = teamId;
    if (category) filter.category = category;
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = parseFloat(minPrice);
      if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
    }

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const [products, total] = await Promise.all([
      Product.find(filter)
        .populate('teamId', 'name country flag')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Product.countDocuments(filter),
    ]);

    return res.status(200).json({
      products,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      limit: limitNum,
    });
  } catch (error) {
    logger.error('Error fetching products:', error);
    return res.status(500).json({
      error: 'Failed to fetch products.',
      code: 'FETCH_FAILED',
    });
  }
};

/**
 * Get a single product by ID
 * GET /api/products/:id
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
const getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('teamId', 'name country flag')
      .lean();

    if (!product) {
      return res.status(404).json({
        error: 'Product not found.',
        code: 'NOT_FOUND',
      });
    }

    return res.status(200).json({ product });
  } catch (error) {
    logger.error('Error fetching product:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        error: 'Invalid product ID.',
        code: 'INVALID_ID',
      });
    }
    return res.status(500).json({
      error: 'Failed to fetch product.',
      code: 'FETCH_FAILED',
    });
  }
};

/**
 * Create a new product
 * POST /api/products
 * Supports multipart/form-data for image upload
 *
 * @param {Object} req - Express request (may contain req.file from Multer)
 * @param {Object} res - Express response
 */
const createProduct = async (req, res) => {
  try {
    const {
      name,
      teamId,
      price,
      description,
      category,
      sizes,
      customization,
      sponsor,
      inStock,
    } = req.body;

    // Basic required field validation
    if (!name || !teamId || !price || !category) {
      // Clean up uploaded file if validation fails
      if (req.file) {
        await deleteUploadedFile(req.file.filename).catch(() => {});
      }
      return res.status(400).json({
        error: 'Missing required fields: name, teamId, price, category.',
        code: 'MISSING_FIELDS',
      });
    }

    // Build product data
    const productData = {
      name,
      teamId,
      price: parseFloat(price),
      description: description || '',
      category,
      inStock: inStock !== undefined ? inStock === 'true' || inStock === true : true,
    };

    // Handle sizes (can be JSON string or array)
    if (sizes) {
      try {
        productData.sizes = typeof sizes === 'string' ? JSON.parse(sizes) : sizes;
      } catch {
        productData.sizes = Array.isArray(sizes) ? sizes : [sizes];
      }
    }

    // Handle customization options (can be JSON string or object)
    if (customization) {
      try {
        productData.customization =
          typeof customization === 'string' ? JSON.parse(customization) : customization;
      } catch {
        // Ignore invalid customization JSON
      }
    }

    // Handle sponsor
    if (sponsor) productData.sponsor = sponsor;

    // Handle uploaded image
    if (req.file) {
      const imageUrl = getFileUrl(req.file.filename);
      productData.imageUrl = imageUrl;
      productData.images = [imageUrl];
    }

    const product = new Product(productData);
    await product.save();
    await product.populate('teamId', 'name country flag');

    logger.info(`Product created: ${product._id} - ${product.name}`);

    return res.status(201).json({
      message: 'Product created successfully.',
      product,
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file) {
      await deleteUploadedFile(req.file.filename).catch(() => {});
    }
    logger.error('Error creating product:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        error: Object.values(error.errors)
          .map((e) => e.message)
          .join(', '),
        code: 'VALIDATION_ERROR',
      });
    }
    return res.status(500).json({
      error: 'Failed to create product.',
      code: 'CREATE_FAILED',
    });
  }
};

/**
 * Update an existing product
 * PUT /api/products/:id
 * Supports multipart/form-data for image upload
 *
 * @param {Object} req - Express request (may contain req.file from Multer)
 * @param {Object} res - Express response
 */
const updateProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      // Clean up uploaded file if product not found
      if (req.file) {
        await deleteUploadedFile(req.file.filename).catch(() => {});
      }
      return res.status(404).json({
        error: 'Product not found.',
        code: 'NOT_FOUND',
      });
    }

    const {
      name,
      teamId,
      price,
      description,
      category,
      sizes,
      customization,
      sponsor,
      inStock,
      removeImage,
    } = req.body;

    // Update fields if provided
    if (name !== undefined) product.name = name;
    if (teamId !== undefined) product.teamId = teamId;
    if (price !== undefined) product.price = parseFloat(price);
    if (description !== undefined) product.description = description;
    if (category !== undefined) product.category = category;
    if (inStock !== undefined) product.inStock = inStock === 'true' || inStock === true;
    if (sponsor !== undefined) product.sponsor = sponsor;

    // Handle sizes update
    if (sizes !== undefined) {
      try {
        product.sizes = typeof sizes === 'string' ? JSON.parse(sizes) : sizes;
      } catch {
        product.sizes = Array.isArray(sizes) ? sizes : [sizes];
      }
    }

    // Handle customization update
    if (customization !== undefined) {
      try {
        product.customization =
          typeof customization === 'string' ? JSON.parse(customization) : customization;
      } catch {
        // Ignore invalid customization JSON
      }
    }

    // Handle image update
    if (req.file) {
      // Delete old primary image if it exists and is a local upload
      if (product.imageUrl && product.imageUrl.startsWith('/uploads/')) {
        const oldFilename = path.basename(product.imageUrl);
        await deleteUploadedFile(oldFilename).catch(() => {});
        // Remove old image from images array
        product.images = product.images.filter((img) => img !== product.imageUrl);
      }

      const newImageUrl = getFileUrl(req.file.filename);
      product.imageUrl = newImageUrl;
      if (!product.images.includes(newImageUrl)) {
        product.images.push(newImageUrl);
      }
    } else if (removeImage === 'true' || removeImage === true) {
      // Remove primary image if requested
      if (product.imageUrl && product.imageUrl.startsWith('/uploads/')) {
        const oldFilename = path.basename(product.imageUrl);
        await deleteUploadedFile(oldFilename).catch(() => {});
        product.images = product.images.filter((img) => img !== product.imageUrl);
      }
      product.imageUrl = undefined;
    }

    await product.save();
    await product.populate('teamId', 'name country flag');

    logger.info(`Product updated: ${product._id} - ${product.name}`);

    return res.status(200).json({
      message: 'Product updated successfully.',
      product,
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file) {
      await deleteUploadedFile(req.file.filename).catch(() => {});
    }
    logger.error('Error updating product:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        error: 'Invalid product ID.',
        code: 'INVALID_ID',
      });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        error: Object.values(error.errors)
          .map((e) => e.message)
          .join(', '),
        code: 'VALIDATION_ERROR',
      });
    }
    return res.status(500).json({
      error: 'Failed to update product.',
      code: 'UPDATE_FAILED',
    });
  }
};

/**
 * Delete a product
 * DELETE /api/products/:id
 *
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 */
const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({
        error: 'Product not found.',
        code: 'NOT_FOUND',
      });
    }

    // Delete all associated images from disk
    const imagesToDelete = [...(product.images || [])];
    if (product.imageUrl && !imagesToDelete.includes(product.imageUrl)) {
      imagesToDelete.push(product.imageUrl);
    }

    await Promise.all(
      imagesToDelete
        .filter((img) => img && img.startsWith('/uploads/'))
        .map((img) => deleteUploadedFile(path.basename(img)).catch(() => {}))
    );

    await Product.findByIdAndDelete(req.params.id);

    logger.info(`Product deleted: ${req.params.id}`);

    return res.status(200).json({
      message: 'Product deleted successfully.',
    });
  } catch (error) {
    logger.error('Error deleting product:', error);
    if (error.name === 'CastError') {
      return res.status(400).json({
        error: 'Invalid product ID.',
        code: 'INVALID_ID',
      });
    }
    return res.status(500).json({
      error: 'Failed to delete product.',
      code: 'DELETE_FAILED',
    });
  }
};

module.exports = {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
