/**
 * Yupoo Category Service
 *
 * Fetches the Yupoo store categories page and parses the HTML into a
 * structured tree of main categories and their subcategories.
 *
 * Caching:
 *   Parsed results are stored in-memory for CACHE_TTL_MS (1 hour) to avoid
 *   hitting the external Yupoo server on every admin request. Pass
 *   `forceRefresh: true` to bypass the cache and re-fetch immediately.
 *
 * Retry logic:
 *   Up to MAX_RETRIES attempts with RETRY_DELAY_MS between each try to
 *   handle transient network errors gracefully.
 *
 * Security:
 *   - Only GET requests are made to a hard-coded Yupoo URL (no user input).
 *   - The response Content-Type is validated to be HTML before cheerio
 *     touches it (prevents inadvertently parsing non-HTML data).
 *   - Timeouts prevent the fetch from hanging indefinitely.
 */

'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

// ─── Configuration ────────────────────────────────────────────────────────────

/** The Yupoo store whose categories we crawl (hard-coded, not user-supplied). */
const YUPOO_BASE_URL = 'https://micom0078.x.yupoo.com';
const CATEGORIES_URL = `${YUPOO_BASE_URL}/categories/`;

/** Maximum time (ms) to wait for Yupoo to respond. */
const FETCH_TIMEOUT_MS = 15_000;

/** How long (ms) to keep the parsed tree in the in-memory cache. */
const CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hour

/** How many times to retry a failed fetch before giving up. */
const MAX_RETRIES = 3;

/** Base delay (ms) between retry attempts (increases linearly). */
const RETRY_DELAY_MS = 500;

// ─── In-Memory Cache ──────────────────────────────────────────────────────────

/**
 * @type {{ data: CategoryTree[]|null, fetchedAt: number|null }}
 */
const cache = {
  data: null,
  fetchedAt: null,
};

/**
 * Returns true when the cache holds a fresh (non-expired) result.
 */
const isCacheValid = () =>
  cache.data !== null &&
  cache.fetchedAt !== null &&
  Date.now() - cache.fetchedAt < CACHE_TTL_MS;

/**
 * Populates the cache with fresh data and records the fetch timestamp.
 *
 * @param {CategoryTree[]} data
 */
const setCache = (data) => {
  cache.data = data;
  cache.fetchedAt = Date.now();
};

/**
 * Invalidates the in-memory cache so the next call re-fetches from Yupoo.
 * Exposed so callers can force a refresh (e.g., via ?refresh=true).
 */
const invalidateCache = () => {
  cache.data = null;
  cache.fetchedAt = null;
};

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

/**
 * Pauses execution for `ms` milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches the raw HTML string of the Yupoo categories page.
 * Retries up to MAX_RETRIES times on network/5xx errors.
 *
 * @returns {Promise<string>} Raw HTML string
 * @throws {AppError} When all retries are exhausted or a non-HTML response is received
 */
const fetchCategoriesHtml = async () => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(`[yupooService] Fetching categories (attempt ${attempt}/${MAX_RETRIES})`, {
        url: CATEGORIES_URL,
      });

      const response = await axios.get(CATEGORIES_URL, {
        timeout: FETCH_TIMEOUT_MS,
        headers: {
          // Mimic a real browser to avoid bot-detection blocks
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
            'AppleWebKit/537.36 (KHTML, like Gecko) ' +
            'Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        // Accept all 2xx status codes; let axios throw on 4xx/5xx
        validateStatus: (status) => status >= 200 && status < 300,
      });

      // Validate that we actually received HTML
      const contentType = response.headers['content-type'] || '';
      if (!contentType.includes('text/html')) {
        throw new AppError(
          `Unexpected Content-Type from Yupoo: "${contentType}". Expected text/html.`,
          502
        );
      }

      logger.info('[yupooService] Categories page fetched successfully', {
        bytes: typeof response.data === 'string' ? response.data.length : 'unknown',
        attempt,
      });

      return response.data;
    } catch (err) {
      lastError = err;

      // Don't retry client errors (4xx) — they won't resolve on retry
      if (err.response && err.response.status >= 400 && err.response.status < 500) {
        logger.error('[yupooService] Client error fetching Yupoo categories — not retrying', {
          status: err.response.status,
          url: CATEGORIES_URL,
        });
        break;
      }

      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt;
        logger.warn(
          `[yupooService] Fetch attempt ${attempt} failed; retrying in ${delay}ms`,
          { error: err.message }
        );
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  logger.error('[yupooService] All fetch attempts failed', {
    url: CATEGORIES_URL,
    error: lastError.message,
  });

  if (lastError instanceof AppError) throw lastError;

  throw new AppError(
    `Failed to fetch Yupoo categories after ${MAX_RETRIES} attempts: ${lastError.message}`,
    502
  );
};

// ─── HTML Parser ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SubCategory
 * @property {string} id           - Numeric category ID extracted from the URL
 * @property {string} name         - Display name of the subcategory
 * @property {string} path         - Full path segment, e.g. "/categories/729135"
 * @property {boolean} isSubCate   - Always true for subcategories
 */

/**
 * @typedef {Object} CategoryTree
 * @property {string}        id               - Numeric category ID extracted from the URL
 * @property {string}        name             - Display name of the category
 * @property {string}        path             - Full URL path, e.g. "/categories/5066922"
 * @property {number}        subcategoryCount - Number of subcategories reported by Yupoo
 * @property {SubCategory[]} subcategories    - Parsed subcategory nodes
 */

/**
 * Extracts the numeric category ID from a Yupoo category URL path.
 * Examples:
 *   "/categories/5066922"           → "5066922"
 *   "/categories/729135?isSubCate=true" → "729135"
 *
 * @param {string} href
 * @returns {string|null} The numeric ID string, or null if unparseable
 */
const extractCategoryId = (href) => {
  if (!href) return null;
  // Strip query string, then grab the last path segment
  const clean = href.split('?')[0];
  const parts = clean.replace(/\/+$/, '').split('/');
  const id = parts[parts.length - 1];
  return /^\d+$/.test(id) ? id : null;
};

/**
 * Parses the raw Yupoo categories HTML into a CategoryTree array.
 *
 * HTML structure expected (simplified):
 * ```html
 * <div class="categories__box-left">
 *   <div class="yupoo-collapse-item">         <!-- main category -->
 *     <div class="yupoo-collapse-header">
 *       <a href="/categories/{id}" title="{name}">...</a>
 *     </div>
 *     <div class="yupoo-collapse-content" data-l="{count}">
 *       <div class="yupoo-collapse-content-box">
 *         <a href="/categories/{id}?isSubCate=true" title="{name}">...</a>
 *         ...
 *       </div>
 *     </div>
 *   </div>
 *   ...
 * </div>
 * ```
 *
 * Special cases handled:
 *   - The "All categories" item (`/categories/` href) is skipped — it is not
 *     a real category.
 *   - Items with no parseable numeric ID are silently skipped.
 *   - Subcategory links that lack `isSubCate=true` are still included if
 *     they carry a numeric id, for robustness.
 *
 * @param {string} html - Raw HTML string from the Yupoo categories page
 * @returns {CategoryTree[]} Parsed category tree (may be empty if the page
 *                           structure doesn't match expectations)
 */
const parseCategories = (html) => {
  const $ = cheerio.load(html);
  const categories = [];

  // Each top-level category is a .yupoo-collapse-item div
  $('.yupoo-collapse-item').each((_i, item) => {
    const $item = $(item);

    // ── Main category link ──────────────────────────────────────────────────
    const $headerLink = $item.find('.yupoo-collapse-header a').first();
    const href = $headerLink.attr('href') || '';
    const name = ($headerLink.attr('title') || $headerLink.text()).trim();

    // Skip the "All categories" pseudo-item (href is exactly "/categories/")
    if (!href || href === '/categories/' || href === '/categories') {
      return; // continue .each()
    }

    const id = extractCategoryId(href);
    if (!id) {
      logger.debug('[yupooService] Skipping category with unparseable href', { href });
      return;
    }

    // Normalise path: strip query string and trailing slash
    const path = href.split('?')[0].replace(/\/+$/, '');

    // ── Subcategory count reported by Yupoo ────────────────────────────────
    const $content = $item.find('.yupoo-collapse-content').first();
    const dataL = $content.attr('data-l');
    const subcategoryCount = dataL !== undefined ? parseInt(dataL, 10) || 0 : 0;

    // ── Subcategory links ──────────────────────────────────────────────────
    const subcategories = [];
    $item.find('.yupoo-collapse-content-box a').each((_j, subLink) => {
      const $sub = $(subLink);
      const subHref = $sub.attr('href') || '';
      const subName = ($sub.attr('title') || $sub.text()).trim();

      const subId = extractCategoryId(subHref);
      if (!subId) {
        logger.debug('[yupooService] Skipping subcategory with unparseable href', {
          href: subHref,
        });
        return;
      }

      const subPath = subHref.split('?')[0].replace(/\/+$/, '');

      subcategories.push({
        id: subId,
        name: subName,
        path: subPath,
        isSubCate: true,
      });
    });

    categories.push({
      id,
      name,
      path,
      subcategoryCount,
      subcategories,
    });
  });

  logger.info('[yupooService] Parsed categories from HTML', {
    total: categories.length,
    withSubcategories: categories.filter((c) => c.subcategories.length > 0).length,
  });

  return categories;
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the Yupoo category tree.
 *
 * Serves the in-memory cache when available (TTL = 1 hour). Forces a fresh
 * fetch when the cache has expired or when `forceRefresh` is true.
 *
 * @param {object}  [options]
 * @param {boolean} [options.forceRefresh=false] - Bypass cache and re-fetch
 * @returns {Promise<CategoryTree[]>} Structured category tree
 */
const getCategories = async ({ forceRefresh = false } = {}) => {
  if (!forceRefresh && isCacheValid()) {
    const ageSeconds = Math.round((Date.now() - cache.fetchedAt) / 1_000);
    logger.debug('[yupooService] Returning cached categories', {
      count: cache.data.length,
      ageSeconds,
    });
    return cache.data;
  }

  if (forceRefresh) {
    logger.info('[yupooService] Force-refresh requested; invalidating cache');
    invalidateCache();
  }

  const html = await fetchCategoriesHtml();
  const categories = parseCategories(html);

  if (categories.length === 0) {
    // Warn but don't throw — the page might legitimately be empty, or the
    // HTML structure may have changed. Callers can decide how to handle this.
    logger.warn(
      '[yupooService] Parsed 0 categories — the Yupoo page structure may have changed'
    );
  }

  setCache(categories);
  return categories;
};

/**
 * Returns the ISO-8601 timestamp of the last successful cache population,
 * or null if the cache has never been populated.
 *
 * @returns {string|null}
 */
const getLastFetchedAt = () =>
  cache.fetchedAt ? new Date(cache.fetchedAt).toISOString() : null;

module.exports = {
  getCategories,
  getLastFetchedAt,
  invalidateCache,
  // Exported for unit-testing only
  _parseCategories: parseCategories,
  _extractCategoryId: extractCategoryId,
};
