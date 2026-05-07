/**
 * Admin — Supplier Routes
 *
 * All routes here require:
 *   1. A valid JWT (`protect` middleware)
 *   2. The user to have the `admin` role (`restrictTo('admin')` middleware)
 *
 * Routes:
 *   GET  /api/admin/supplier-categories
 *     Fetch the supplier category tree (main categories + subcategories).
 *     Supports ?refresh=true to bypass the server-side 1-hour cache.
 *
 *   POST /api/admin/crawl-products
 *     Accept selected category nodes, crawl each category page, parse
 *     album/product blocks, and bulk-create products in Firestore.
 *     Body: { selectedCategories: CategoryNode[], defaults?: ProductDefaults }
 *
 * Rate limiting:
 *   A dedicated, stricter limiter (5 requests / minute / IP) is applied to
 *   all routes in this module because they trigger outbound HTTP requests to
 *   the external supplier server and we must not flood it.
 */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect, restrictTo } = require('../../../middleware/auth');
const { validate, schemas } = require('../../../middleware/validation');
const supplierCtrl = require('../../../controllers/supplierCtrl');

const router = express.Router();

// ─── Rate Limiter (stricter — triggers external HTTP) ─────────────────────────

/**
 * 5 requests per minute per IP for all admin supplier routes.
 * This prevents accidental or malicious hammering of the supplier server.
 */
const supplierLimiter = rateLimit({
  windowMs: 60 * 1_000, // 1 minute
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many supplier requests. Please wait a minute before trying again.',
  },
});

// Apply auth middleware to ALL routes in this router
router.use(protect, restrictTo('admin'));

/**
 * @route   GET /api/admin/supplier-categories
 * @desc    Fetch the supplier store category tree (main + sub categories).
 *          Results are cached server-side for 1 hour.
 *          Pass ?refresh=true to force a live re-fetch.
 * @access  Admin only
 *
 * @queryparam {boolean} [refresh] - Force cache invalidation before fetch
 *
 * @returns {200} { status, fetchedAt, cached, count, data: { categories: CategoryTree[] } }
 * @returns {401} Unauthenticated
 * @returns {403} Insufficient privileges
 * @returns {429} Rate limit exceeded
 * @returns {502} Upstream supplier fetch failed
 */
router.get('/supplier-categories', supplierLimiter, supplierCtrl.getSupplierCategories);

/**
 * @route   POST /api/admin/crawl-products
 * @desc    Crawl selected supplier categories, parse album/product blocks, and
 *          bulk-create products in Firestore.
 *
 *          Body:
 *          {
 *            selectedCategories: [
 *              { id: string, name: string, path: string, isSubCate?: boolean }
 *            ],
 *            defaults?: {
 *              price?: number,
 *              kitType?: 'home' | 'away' | 'third' | 'goalkeeper',
 *              stock?: number,
 *              sizes?: string[]
 *            }
 *          }
 *
 * @access  Admin only
 *
 * @returns {200} {
 *   status: 'success',
 *   data: { created: N, skipped: N, errors: [...], ids: [...] }
 * }
 * @returns {400} Validation failure
 * @returns {401} Unauthenticated
 * @returns {403} Insufficient privileges
 * @returns {422} Validation schema error
 * @returns {429} Rate limit exceeded
 * @returns {500} Unexpected server error
 */
router.post(
  '/crawl-products',
  supplierLimiter,
  validate(schemas.crawlProducts),
  supplierCtrl.crawlProducts
);

module.exports = router;
