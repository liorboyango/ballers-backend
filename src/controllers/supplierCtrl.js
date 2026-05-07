/**
 * Supplier Controller
 *
 * Handles admin endpoints related to supplier category browsing and
 * product crawling.
 *
 * Implemented endpoints:
 *   GET  /api/admin/supplier-categories  — fetch and return the supplier category tree.
 *   POST /api/admin/crawl-products       — accept selected category nodes, fetch each
 *                                          category page, parse albums, create products.
 */

'use strict';

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const {
  getCategories,
  getLastFetchedAt,
  crawlSelectedCategories,
} = require('../services/supplierService');

// ─── GET /api/admin/supplier-categories ──────────────────────────────────────

/**
 * GET /api/admin/supplier-categories
 *
 * Fetches the category tree from the configured supplier site, parses the
 * HTML with cheerio, and returns a structured JSON tree.
 *
 * Query parameters:
 *   refresh (boolean, optional) — pass "true" to bypass the in-memory cache
 *     and force a live re-fetch from the supplier.
 *
 * Response shape:
 * ```json
 * {
 *   "status": "success",
 *   "fetchedAt": "2026-05-07T16:00:00.000Z",
 *   "cached": true,
 *   "count": 5,
 *   "data": {
 *     "categories": [
 *       {
 *         "id": "5066922",
 *         "name": "Brasileiro Série A",
 *         "path": "/categories/5066922",
 *         "subcategoryCount": 23,
 *         "subcategories": [ ... ]
 *       }
 *     ]
 *   }
 * }
 * ```
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
exports.getSupplierCategories = asyncHandler(async (req, res, next) => {
  const forceRefresh = req.query.refresh === 'true';
  const t0 = Date.now();

  logger.info('[supplierCtrl] getSupplierCategories called', {
    userId: req.user && req.user.id,
    forceRefresh,
    ip: req.ip,
  });

  const previousFetchedAt = getLastFetchedAt();

  let categories;
  try {
    categories = await getCategories({ forceRefresh });
  } catch (err) {
    // Surface upstream supplier errors with a clear 502 rather than a generic 500
    const statusCode = err.statusCode || 502;
    logger.error('[supplierCtrl] Failed to fetch/parse categories', {
      error: err.message,
      userId: req.user && req.user.id,
      durationMs: Date.now() - t0,
    });
    return next(
      new AppError(
        `Unable to fetch categories from supplier: ${err.message}`,
        statusCode
      )
    );
  }

  const fetchedAt = getLastFetchedAt();
  const cached = !forceRefresh && fetchedAt === previousFetchedAt && fetchedAt !== null;
  const durationMs = Date.now() - t0;

  logger.info('[supplierCtrl] Returning categories', {
    count: categories.length,
    cached,
    fetchedAt,
    durationMs,
  });

  res.status(200).json({
    status: 'success',
    fetchedAt,
    cached,
    count: categories.length,
    data: { categories },
    cachedAt: fetchedAt,
  });
});

// ─── POST /api/admin/crawl-products ──────────────────────────────────────────

/**
 * POST /api/admin/crawl-products
 *
 * Accepts a list of selected supplier category nodes, crawls each category
 * page, parses album/product blocks, and bulk-creates products in Firestore.
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
 *       { "category": "Atlético Mineiro", "product": "Jersey Name", "message": "...", "errorType": "timeout" }
 *     ],
 *     "ids": ["abc123", "def456", "ghi789"],
 *     "durationMs": 12400,
 *     "aborted": false
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

  const userId = req.user && req.user.id;
  const t0 = Date.now();

  logger.info('[supplierCtrl] crawlProducts called', {
    userId,
    categoryCount: selectedCategories.length,
    defaults,
    ip: req.ip,
  });

  const result = await crawlSelectedCategories(
    selectedCategories,
    defaults,
    {
      userId,
      // jobId is auto-generated inside crawlSelectedCategories if not provided
    }
  );

  const durationMs = Date.now() - t0;

  logger.info('[supplierCtrl] crawlProducts complete', {
    userId,
    created: result.created,
    skipped: result.skipped,
    errors: result.errors.length,
    aborted: result.aborted,
    durationMs,
  });

  res.status(200).json({
    status: 'success',
    data: {
      created: result.created,
      skipped: result.skipped,
      errors: result.errors,
      ids: result.ids,
      durationMs: result.durationMs,
      aborted: result.aborted,
    },
  });
});
