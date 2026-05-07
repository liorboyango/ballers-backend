/**
 * Yupoo Controller
 *
 * Handles admin endpoints related to Yupoo category browsing and
 * product crawling.
 *
 * Currently implemented:
 *   GET /api/admin/yupoo-categories — fetch and return the Yupoo
 *     category tree (main categories + subcategories).
 */

'use strict';

const asyncHandler = require('../utils/asyncHandler');
const logger = require('../utils/logger');
const { getCategories, getLastFetchedAt } = require('../services/yupooService');

/**
 * GET /api/admin/yupoo-categories
 *
 * Fetches the category tree from https://micom0078.x.yupoo.com/categories/,
 * parses the HTML with cheerio, and returns a structured JSON tree.
 *
 * Query parameters:
 *   refresh (boolean, optional) — pass "true" to bypass the in-memory cache
 *     and force a live re-fetch from Yupoo. Defaults to false.
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
 *       "subcategories": [
 *         {
 *           "id": "729135",
 *           "name": "Atlético Mineiro",
 *           "path": "/categories/729135",
 *           "isSubCate": true
 *         }
 *       ]
 *     }
 *   ]
 * }
 * ```
 *
 * Error responses:
 *   502 — Yupoo fetch failed (network error or unexpected response format)
 *   500 — Unexpected server error
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
  // If fetchedAt didn't change (same timestamp) and we didn't force a refresh,
  // the result came from cache.
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
