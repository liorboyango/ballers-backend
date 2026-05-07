/**
 * Admin — Yupoo Routes
 *
 * All routes here require:
 *   1. A valid JWT (`protect` middleware)
 *   2. The user to have the `admin` role (`restrictTo('admin')` middleware)
 *
 * Routes:
 *   GET /api/admin/yupoo-categories
 *     Fetch the Yupoo category tree (main categories + subcategories).
 *     Supports ?refresh=true to bypass the server-side 1-hour cache.
 *
 * Rate limiting:
 *   A dedicated, stricter limiter (5 requests / minute / IP) is applied to
 *   all routes in this module because they trigger outbound HTTP requests to
 *   the external Yupoo server and we must not flood it.
 */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, restrictTo } = require('../../../middleware/auth');
const yupooCtrl = require('../../../controllers/yupooCtrl');

const router = express.Router();

// ─── Rate Limiter (stricter — triggers external HTTP) ─────────────────────────

/**
 * 5 requests per minute per IP for all admin yupoo routes.
 * This prevents accidental or malicious hammering of the Yupoo server.
 */
const yupooLimiter = rateLimit({
  windowMs: 60 * 1_000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many Yupoo requests. Please wait a minute before trying again.',
  },
});

// Apply auth middleware to ALL routes in this router
router.use(protect, restrictTo('admin'));

/**
 * @route   GET /api/admin/yupoo-categories
 * @desc    Fetch the Yupoo store category tree (main + sub categories).
 *          Results are cached server-side for 1 hour.
 *          Pass ?refresh=true to force a live re-fetch.
 * @access  Admin only
 *
 * @queryparam {boolean} [refresh] - Force cache invalidation before fetch
 *
 * @returns {200} { status, fetchedAt, cached, count, data: CategoryTree[] }
 * @returns {401} Unauthenticated
 * @returns {403} Insufficient privileges
 * @returns {429} Rate limit exceeded
 * @returns {502} Upstream Yupoo fetch failed
 */
router.get('/yupoo-categories', yupooLimiter, yupooCtrl.getYupooCategories);

module.exports = router;
