/**
 * Product Controller
 * Handles teams listing and product catalog endpoints.
 */

const Team = require('../models/Team');
const Product = require('../models/Product');
const logger = require('../utils/logger');

/**
 * GET /api/teams
 * Returns all active teams.
 */
const getTeams = async (req, res, next) => {
  try {
    const teams = await Team.find({ isActive: true }).sort({ name: 1 });
    res.status(200).json({ teams, count: teams.length });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/teams/:id
 * Returns a single team by ID.
 */
const getTeamById = async (req, res, next) => {
  try {
    const team = await Team.findById(req.params.id);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    res.status(200).json({ team });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/products
 * Returns products with optional filtering by teamId, kitType, size.
 * Supports pagination via ?page and ?limit.
 */
const getProducts = async (req, res, next) => {
  try {
    const { teamId, kitType, size, featured, page = 1, limit = 20 } = req.query;

    const filter = { isActive: true };
    if (teamId) filter.team = teamId;
    if (kitType) filter.kitType = kitType;
    if (size) filter.sizes = size;
    if (featured === 'true') filter.isFeatured = true;

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .populate('team', 'name country flagUrl group')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit, 10));

    res.status(200).json({
      products,
      pagination: {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        pages: Math.ceil(total / parseInt(limit, 10)),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/products/:id
 * Returns a single product by ID with team details.
 */
const getProductById = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id).populate(
      'team',
      'name country flagUrl group confederation'
    );
    if (!product || !product.isActive) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(200).json({ product });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/products  (admin only)
 * Create a new product. Handles image upload via Multer.
 */
const createProduct = async (req, res, next) => {
  try {
    const productData = { ...req.body };

    // Attach uploaded image if present
    if (req.file) {
      productData.images = [
        {
          url: `/uploads/${req.file.filename}`,
          alt: productData.name || 'Product image',
          isPrimary: true,
        },
      ];
    }

    // Parse JSON fields sent as strings in multipart form
    if (typeof productData.customization === 'string') {
      productData.customization = JSON.parse(productData.customization);
    }
    if (typeof productData.sizes === 'string') {
      productData.sizes = JSON.parse(productData.sizes);
    }

    const product = await Product.create(productData);
    await product.populate('team', 'name country flagUrl');

    logger.info(`Product created: ${product.name}`);
    res.status(201).json({ message: 'Product created', product });
  } catch (err) {
    next(err);
  }
};

/**
 * PUT /api/products/:id  (admin only)
 * Update an existing product.
 */
const updateProduct = async (req, res, next) => {
  try {
    const updateData = { ...req.body };

    if (req.file) {
      updateData.$push = {
        images: {
          url: `/uploads/${req.file.filename}`,
          alt: updateData.name || 'Product image',
          isPrimary: false,
        },
      };
    }

    const product = await Product.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true,
    }).populate('team', 'name country flagUrl');

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    res.status(200).json({ message: 'Product updated', product });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/products/:id  (admin only)
 * Soft-delete a product by setting isActive = false.
 */
const deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.status(200).json({ message: 'Product deleted' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getTeams,
  getTeamById,
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
};
