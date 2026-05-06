/**
 * Teams Router
 * Handles all /api/teams routes.
 *
 * Public endpoints (no auth required):
 *   GET /api/teams          - List all teams with optional filtering & pagination
 *   GET /api/teams/:id      - Get a single team by ID (with its products count)
 */

const express = require('express');
const Joi = require('joi');
const { getTeams } = require('../../controllers/productCtrl');
const Team = require('../../models/Team');
const logger = require('../../utils/logger');

const router = express.Router();

/**
 * Joi validation schema for GET /api/teams query parameters.
 */
const teamsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  group: Joi.string().uppercase().length(1).optional(),
  search: Joi.string().max(100).optional(),
  sort: Joi.string()
    .valid('name', '-name', 'country', '-country', 'group', '-group', 'createdAt', '-createdAt')
    .default('name'),
});

/**
 * Middleware: validate query params for listing teams.
 */
function validateTeamsQuery(req, res, next) {
  const { error, value } = teamsQuerySchema.validate(req.query, { abortEarly: false });
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
 * GET /api/teams
 * List all World Cup teams.
 *
 * Query params:
 *   - page    {number}  Page number (default: 1)
 *   - limit   {number}  Items per page (default: 50, max: 100)
 *   - group   {string}  Filter by group letter (A-H)
 *   - search  {string}  Search by name or country
 *   - sort    {string}  Sort field (name, country, group, createdAt; prefix '-' for desc)
 *
 * Response 200:
 * {
 *   success: true,
 *   data: Team[],
 *   pagination: { total, page, limit, totalPages, hasNextPage, hasPrevPage }
 * }
 */
router.get('/', validateTeamsQuery, getTeams);

/**
 * GET /api/teams/:id
 * Get a single team by MongoDB ObjectId.
 * Also returns the count of products available for this team.
 *
 * Response 200:
 * {
 *   success: true,
 *   data: { ...team, productCount: number }
 * }
 *
 * Response 400: Invalid ID format
 * Response 404: Team not found
 */
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!id.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid team ID format.',
      });
    }

    const Product = require('../../models/Product');

    const [team, productCount] = await Promise.all([
      Team.findById(id).select('-__v').lean(),
      Product.countDocuments({ team: id }),
    ]);

    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found.',
      });
    }

    logger.info(`GET /api/teams/${id} - found team: ${team.name}`);

    return res.status(200).json({
      success: true,
      data: { ...team, productCount },
    });
  } catch (err) {
    logger.error(`GET /api/teams/:id error: ${err.message}`);
    next(err);
  }
});

module.exports = router;
