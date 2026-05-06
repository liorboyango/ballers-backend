/**
 * Team Controller
 * Handles retrieval of World Cup team data.
 * All team endpoints are public (no authentication required).
 *
 * Note: Firestore lacks regex/$or, so the `search` filter is applied
 * in-memory after the database query (the team list is small and bounded).
 */
const Team = require('../models/Team');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

exports.getTeams = asyncHandler(async (req, res, next) => {
  const { group, search, page = 1, limit = 50 } = req.query;

  let query = Team.collection().orderBy('name', 'asc');
  if (group) query = query.where('group', '==', group.toUpperCase());

  let docs = (await query.get()).docs.map(Team.serialize);

  if (search) {
    const needle = search.toLowerCase();
    docs = docs.filter(
      (t) =>
        (t.name && t.name.toLowerCase().includes(needle)) ||
        (t.country && t.country.toLowerCase().includes(needle))
    );
  }

  const total = docs.length;
  const pageNum = parseInt(page, 10);
  const limitNum = Math.min(parseInt(limit, 10), 100);
  const skip = (pageNum - 1) * limitNum;
  const teams = docs.slice(skip, skip + limitNum);

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

exports.getTeamById = asyncHandler(async (req, res, next) => {
  const snap = await Team.collection().doc(req.params.id).get();
  if (!snap.exists) {
    return next(new AppError('Team not found.', 404));
  }
  res.status(200).json({
    status: 'success',
    data: Team.serialize(snap),
  });
});
