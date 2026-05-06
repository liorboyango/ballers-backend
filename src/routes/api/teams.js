/**
 * Team Routes
 * All team routes are public (no authentication required).
 * GET /api/teams      - List all teams
 * GET /api/teams/:id  - Get team by ID
 */
const express = require('express');
const router = express.Router();
const teamCtrl = require('../../controllers/teamCtrl');
const { validate, schemas } = require('../../middleware/validation');

/**
 * @route   GET /api/teams
 * @desc    List all World Cup teams
 * @access  Public
 */
router.get('/', teamCtrl.getTeams);

/**
 * @route   GET /api/teams/:id
 * @desc    Get a single team by ID
 * @access  Public
 */
router.get('/:id', validate(schemas.objectIdParam, 'params'), teamCtrl.getTeamById);

module.exports = router;
