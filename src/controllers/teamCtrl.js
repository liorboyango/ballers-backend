/**
 * Team Controller
 * Handles retrieval of World Cup team data.
 * All team endpoints are public (no authentication required).
 */
const Team = require('../models/Team');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * GET /api/teams
 * List all World Cup teams with optional filtering
 * @query {string} [group] - Filter by group (A-H)
 * @query {string} [search] - Search by team name or country
 * @query {number} [page=1] - Page number
 * @query {number} [limit=50] - Items per page
 */
exports.getTeams = asyncHandler(async (req, res, next) => {
  const { group, search, page = 1, limit = 50 } = req.query;

  const filter = {};
  if (group) filter.group = group.toUpperCase();
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { country: { $regex: search, $options: 'i' } },
    ];
  }

  const pageNum = parseInt(page, 10);
  const limitNum = Math.min(parseInt(limit, 10), 100);
  const skip = (pageNum - 1) * limitNum;

  const [teams, total] = await Promise.all([
    Team.find(filter).sort({ name: 1 }).skip(skip).limit(limitNum).lean(),
    Team.countDocuments(filter),
  ]);

  res.status(200).json({
    status: 'success',
    results: teams.length,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
    data: teams,
  });
});

/**
 * GET /api/teams/:id
 * Get a single team by ID
 * @param {string} id - MongoDB ObjectId of the team
 */
exports.getTeamById = asyncHandler(async (req, res, next) => {
  const team = await Team.findById(req.params.id).lean();

  if (!team) {
    return next(new AppError('Team not found.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: team,
  });
});
