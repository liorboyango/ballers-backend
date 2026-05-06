/**
 * Product Controller
 * Handles business logic for teams and products endpoints.
 * Supports filtering by teamId, pagination, and sorting.
 */

const Team = require('../models/Team');
const Product = require('../models/Product');
const logger = require('../utils/logger');

/**
 * GET /api/teams
 * Returns all teams, optionally filtered by group or search query.
 * Supports pagination via ?page and ?limit query params.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getTeams(req, res, next) {
  try {
    const {
      page = 1,
      limit = 50,
      group,
      search,
      sort = 'name',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    // Build filter query
    const filter = {};

    if (group) {
      filter.group = group.toUpperCase();
    }

    if (search) {
      // Case-insensitive search on team name or country
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { country: { $regex: search, $options: 'i' } },
      ];
    }

    // Determine sort order
    const sortOptions = {};
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    const sortDir = sort.startsWith('-') ? -1 : 1;
    const allowedSortFields = ['name', 'country', 'group', 'createdAt'];
    if (allowedSortFields.includes(sortField)) {
      sortOptions[sortField] = sortDir;
    } else {
      sortOptions.name = 1;
    }

    const [teams, total] = await Promise.all([
      Team.find(filter)
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .select('-__v')
        .lean(),
      Team.countDocuments(filter),
    ]);

    logger.info(`GET /api/teams - returned ${teams.length} teams (total: ${total})`);

    return res.status(200).json({
      success: true,
      data: teams,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        hasNextPage: pageNum < Math.ceil(total / limitNum),
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (err) {
    logger.error(`GET /api/teams error: ${err.message}`);
    next(err);
  }
}

/**
 * GET /api/products
 * Returns products, optionally filtered by teamId, kitType, size, price range.
 * Supports pagination and sorting.
 *
 * Query params:
 *   - teamId: filter by team ObjectId
 *   - kitType: 'home' | 'away' | 'third'
 *   - size: 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL'
 *   - minPrice: minimum price (number)
 *   - maxPrice: maximum price (number)
 *   - page: page number (default 1)
 *   - limit: items per page (default 12, max 100)
 *   - sort: field to sort by, prefix with '-' for descending (default '-createdAt')
 *   - search: text search on name/description
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getProducts(req, res, next) {
  try {
    const {
      teamId,
      kitType,
      size,
      minPrice,
      maxPrice,
      page = 1,
      limit = 12,
      sort = '-createdAt',
      search,
      inStock,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const skip = (pageNum - 1) * limitNum;

    // Build filter query
    const filter = {};

    if (teamId) {
      filter.team = teamId;
    }

    if (kitType) {
      const allowedKitTypes = ['home', 'away', 'third'];
      if (allowedKitTypes.includes(kitType.toLowerCase())) {
        filter.kitType = kitType.toLowerCase();
      }
    }

    if (size) {
      const allowedSizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
      const sizeUpper = size.toUpperCase();
      if (allowedSizes.includes(sizeUpper)) {
        // Filter products that have this size available
        filter['sizes.size'] = sizeUpper;
      }
    }

    // Price range filter
    if (minPrice !== undefined || maxPrice !== undefined) {
      filter.price = {};
      if (minPrice !== undefined) {
        const min = parseFloat(minPrice);
        if (!isNaN(min)) filter.price.$gte = min;
      }
      if (maxPrice !== undefined) {
        const max = parseFloat(maxPrice);
        if (!isNaN(max)) filter.price.$lte = max;
      }
    }

    // In-stock filter
    if (inStock === 'true') {
      filter['sizes.stock'] = { $gt: 0 };
    }

    // Text search
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    // Determine sort order
    const sortOptions = {};
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    const sortDir = sort.startsWith('-') ? -1 : 1;
    const allowedSortFields = ['name', 'price', 'createdAt', 'kitType'];
    if (allowedSortFields.includes(sortField)) {
      sortOptions[sortField] = sortDir;
    } else {
      sortOptions.createdAt = -1;
    }

    const [products, total] = await Promise.all([
      Product.find(filter)
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .populate('team', 'name country flag group')
        .select('-__v')
        .lean(),
      Product.countDocuments(filter),
    ]);

    logger.info(
      `GET /api/products - teamId=${teamId || 'all'}, returned ${products.length} products (total: ${total})`
    );

    return res.status(200).json({
      success: true,
      data: products,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
        hasNextPage: pageNum < Math.ceil(total / limitNum),
        hasPrevPage: pageNum > 1,
      },
    });
  } catch (err) {
    logger.error(`GET /api/products error: ${err.message}`);
    next(err);
  }
}

/**
 * GET /api/products/:id
 * Returns a single product by its MongoDB ObjectId.
 * Populates the team reference with name, country, flag, and group.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function getProductById(req, res, next) {
  try {
    const { id } = req.params;

    // Validate ObjectId format to avoid CastError
    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid product ID format.',
      });
    }

    const product = await Product.findById(id)
      .populate('team', 'name country flag group')
      .select('-__v')
      .lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found.',
      });
    }

    logger.info(`GET /api/products/${id} - found product: ${product.name}`);

    return res.status(200).json({
      success: true,
      data: product,
    });
  } catch (err) {
    logger.error(`GET /api/products/:id error: ${err.message}`);
    next(err);
  }
}

module.exports = {
  getTeams,
  getProducts,
  getProductById,
};
