/**
 * Yupoo Controller
 *
 * Handles admin endpoints related to Yupoo category browsing and
 * product crawling.
 *
 * Implemented endpoints:
 *   GET  /api/admin/yupoo-categories  — fetch and return the Yupoo category tree.
 *   POST /api/admin/crawl-products    — accept selected category nodes, fetch each
 *                                       category page, parse albums, create products.
 */

'use strict';

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {
  getCategories,
  getLastFetchedAt,
  crawlSelectedCategories,
} = require('../services/yupooService');

// ─── GET /api/admin/yupoo-categories ─────────────────────────────────────────

/**
 * GET /api/admin/yupoo-categories
 *
 * Fetches the category tree from https://micom0078.x.yupoo.com/categories/,
 * parses the HTML with cheerio, and returns a structured JSON tree.
 *
 * Query parameters:
 *   refresh (boolean, optional) — pass "true" to bypass the in-memory cache
 *     and force a live re-fetch from Yupoo.
 *
 * Response shape:
 * ```json
 * {
 *   "status": "success",
 *   "fetchedAt": "2026-05-07T16:00:00.000Z",
 *   "cached": true,
 *   "count": 5,
 *   "data": [
 *     {
 *       "id": "5066922",
 *       "name": "Brasileiro Série A",
 *       "path": "/categories/5066922",
 *       "subcategoryCount": 23,
 *       "subcategories": [ ... ]
 *     }
 *   ]
 * }
 * ```
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
exports.getYupooCategories = asyncHandler(async (req, res, next) => {
  const forceRefresh = req.query.refresh === 'true';

  logger.info('[yupooCtrl] getYupooCategories called', {
    userId: req.user && req.user.id,
    forceRefresh,
    ip: req.ip,
  });

  const previousFetchedAt = getLastFetchedAt();

  const categories = await getCategories({ forceRefresh });

  const fetchedAt = getLastFetchedAt();
  const cached = !forceRefresh && fetchedAt === previousFetchedAt && fetchedAt !== null;

  logger.info('[yupooCtrl] Returning categories', {
    count: categories.length,
    cached,
    fetchedAt,
  });

  res.status(200).json({
    status: 'success',
    fetchedAt,
    cached,
    count: categories.length,
    data: categories,
  });
});

// ─── POST /api/admin/crawl-products ──────────────────────────────────────────

/**
 * POST /api/admin/crawl-products
 *
 * Accepts a list of selected Yupoo category nodes, crawls each category page,
 * parses album/product blocks, and bulk-creates products in Firestore.
 *
 * Request body:
 * ```json
 * {
 *   "selectedCategories": [
 *     { "id": "729135", "name": "Atlético Mineiro", "path": "/categories/729135", "isSubCate": true }
 *   ],
 *   "defaults": {
 *     "price":  99.99,
 *     "kitType": "home",
 *     "stock":  10,
 *     "sizes":  ["S", "M", "L", "XL", "XXL"]
 *   }
 * }
 * ```
 *
 * Response shape:
 * ```json
 * {
 *   "status": "success",
 *   "data": {
 *     "created": 3,
 *     "skipped": 1,
 *     "errors": [
 *       { "category": "Atlético Mineiro", "product": "Jersey Name", "message": "..." }
 *     ],
 *     "ids": ["abc123", "def456", "ghi789"]
 *   }
 * }
 * ```
 *
 * HTTP status codes:
 *   200 — Crawl completed (even if some individual items failed — check errors[]).
 *   400 — Validation failure (selectedCategories missing or empty).
 *   401 — Not authenticated.
 *   403 — Not admin.
 *   429 — Rate limit exceeded.
 *   500 — Unexpected server error.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
exports.crawlProducts = asyncHandler(async (req, res, next) => {
  const { selectedCategories, defaults = {} } = req.body;

  // Validation is handled by the Joi schema middleware, but we add a runtime
  // guard here for defence-in-depth.
  if (!Array.isArray(selectedCategories) || selectedCategories.length === 0) {
    return next(
      new AppError(
        'selectedCategories must be a non-empty array of category objects.',
        400
      )
    );
  }

  logger.info('[yupooCtrl] crawlProducts called', {
    userId: req.user && req.user.id,
    categoryCount: selectedCategories.length,
    defaults,
    ip: req.ip,
  });

  const result = await crawlSelectedCategories(
    selectedCategories,
    defaults
  );

  logger.info('[yupooCtrl] crawlProducts complete', {
    userId: req.user && req.user.id,
    created: result.created,
    skipped: result.skipped,
    errors: result.errors.length,
  });

  res.status(200).json({
    status: 'success',
    data: {
      created: result.created,
      skipped: result.skipped,
      errors: result.errors,
      ids: result.ids,
    },
  });
});
