/**
 * Yupoo Category & Crawl Service
 *
 * Fetches the Yupoo store categories page and parses the HTML into a
 * structured tree of main categories and their subcategories.
 *
 * Also exposes crawlSelectedCategories() which fetches every individual
 * category page, parses album/product blocks, and creates products via
 * the internal createProduct helper.
 *
 * Caching:
 *   Parsed category results are stored in-memory for CACHE_TTL_MS (1 hour)
 *   to avoid hitting the external Yupoo server on every admin request.
 *
 * Retry logic:
 *   Up to MAX_RETRIES attempts with RETRY_DELAY_MS between each try to
 *   handle transient network errors gracefully.
 *
 * Security:
 *   - Only GET requests are made to a hard-coded Yupoo URL (no user input).
 *   - The response Content-Type is validated to be HTML before cheerio
 *     touches it.
 *   - Timeouts prevent the fetch from hanging indefinitely.
 *   - External image URLs are validated against the yupoo photo domain
 *     before being passed to the product creation pipeline.
 */

'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const { admin } = require('./db');
const Product = require('../models/Product');
const { downloadAndUploadImages } = require('./upload');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

// ─── Configuration ────────────────────────────────────────────────────────────

/** The Yupoo store whose categories we crawl (hard-coded, not user-supplied). */
const YUPOO_BASE_URL = 'https://micom0078.x.yupoo.com';
const CATEGORIES_URL = `${YUPOO_BASE_URL}/categories/`;

/** Allowed image hostname for URL-origin validation. */
const YUPOO_PHOTO_HOSTNAME = 'photo.yupoo.com';

/** Maximum time (ms) to wait for Yupoo to respond per request. */
const FETCH_TIMEOUT_MS = 20_000;

/** How long (ms) to keep the parsed tree in the in-memory cache. */
const CACHE_TTL_MS = 60 * 60 * 1_000; // 1 hour

/** How many times to retry a failed fetch before giving up. */
const MAX_RETRIES = 3;

/** Base delay (ms) between retry attempts (increases linearly). */
const RETRY_DELAY_MS = 500;

/**
 * Polite crawl delay range (ms). A random value between MIN and MAX is
 * awaited between consecutive category-page requests to avoid hammering
 * the Yupoo server.
 */
const CRAWL_DELAY_MIN_MS = 500;
const CRAWL_DELAY_MAX_MS = 1_000;

/** Maximum images to collect per product album. */
const MAX_IMAGES_PER_PRODUCT = 10;

// ─── In-Memory Category Cache ─────────────────────────────────────────────────

/**
 * @type {{ data: CategoryTree[]|null, fetchedAt: number|null }}
 */
const cache = {
  data: null,
  fetchedAt: null,
};

const isCacheValid = () =>
  cache.data !== null &&
  cache.fetchedAt !== null &&
  Date.now() - cache.fetchedAt < CACHE_TTL_MS;

const setCache = (data) => {
  cache.data = data;
  cache.fetchedAt = Date.now();
};

const invalidateCache = () => {
  cache.data = null;
  cache.fetchedAt = null;
};

// ─── HTTP Helpers ─────────────────────────────────────────────────────────────

/**
 * Pauses execution for `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns a random integer between min (inclusive) and max (inclusive).
 */
const randomBetween = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Shared browser-like HTTP headers used for all Yupoo GET requests.
 */
const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/124.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

/**
 * Fetches a Yupoo HTML page with retry logic.
 *
 * @param {string} url - Full URL to fetch
 * @param {string} [label] - Human-readable label used in log messages
 * @returns {Promise<string>} Raw HTML string
 * @throws {AppError} When all retries are exhausted or a non-HTML response
 */
const fetchYupooPage = async (url, label = url) => {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(`[yupooService] Fetching "${label}" (attempt ${attempt}/${MAX_RETRIES})`, {
        url,
      });

      const response = await axios.get(url, {
        timeout: FETCH_TIMEOUT_MS,
        headers: BROWSER_HEADERS,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      const contentType = response.headers['content-type'] || '';
      if (!contentType.includes('text/html')) {
        throw new AppError(
          `Unexpected Content-Type from Yupoo: "${contentType}". Expected text/html.`,
          502
        );
      }

      logger.info(`[yupooService] Fetched "${label}" successfully`, {
        bytes: typeof response.data === 'string' ? response.data.length : 'unknown',
        attempt,
      });

      return response.data;
    } catch (err) {
      lastError = err;

      // Do not retry client errors — they won't resolve on retry
      if (err.response && err.response.status >= 400 && err.response.status < 500) {
        logger.error(
          `[yupooService] Client error (${err.response.status}) fetching "${label}" — not retrying`
        );
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

  logger.error(`[yupooService] All fetch attempts failed for "${label}"`, {
    url,
    error: lastError && lastError.message,
  });

  if (lastError instanceof AppError) throw lastError;

  throw new AppError(
    `Failed to fetch Yupoo page "${label}" after ${MAX_RETRIES} attempts: ${
      lastError ? lastError.message : 'unknown error'
    }`,
    502
  );
};

// ─── Category List Parser ─────────────────────────────────────────────────────

/**
 * @typedef {Object} SubCategory
 * @property {string} id           - Numeric category ID extracted from the URL
 * @property {string} name         - Display name of the subcategory
 * @property {string} path         - Full path segment, e.g. "/categories/729135"
 * @property {boolean} isSubCate   - Always true for subcategories
 */

/**
 * @typedef {Object} CategoryTree
 * @property {string}        id               - Numeric category ID
 * @property {string}        name             - Display name of the category
 * @property {string}        path             - Full URL path
 * @property {number}        subcategoryCount - Number of subcategories
 * @property {SubCategory[]} subcategories    - Parsed subcategory nodes
 */

/**
 * Extracts the numeric category ID from a Yupoo category URL path.
 *
 * @param {string} href
 * @returns {string|null}
 */
const extractCategoryId = (href) => {
  if (!href) return null;
  const clean = href.split('?')[0];
  const parts = clean.replace(/\/+$/, '').split('/');
  const id = parts[parts.length - 1];
  return /^\d+$/.test(id) ? id : null;
};

/**
 * Parses the raw Yupoo categories HTML into a CategoryTree array.
 *
 * @param {string} html - Raw HTML string from the Yupoo categories page
 * @returns {CategoryTree[]}
 */
const parseCategories = (html) => {
  const $ = cheerio.load(html);
  const categories = [];

  $('.yupoo-collapse-item').each((_i, item) => {
    const $item = $(item);

    const $headerLink = $item.find('.yupoo-collapse-header a').first();
    const href = $headerLink.attr('href') || '';
    const name = ($headerLink.attr('title') || $headerLink.text()).trim();

    // Skip the "All categories" pseudo-item
    if (!href || href === '/categories/' || href === '/categories') {
      return;
    }

    const id = extractCategoryId(href);
    if (!id) {
      logger.debug('[yupooService] Skipping category with unparseable href', { href });
      return;
    }

    const path = href.split('?')[0].replace(/\/+$/, '');

    const $content = $item.find('.yupoo-collapse-content').first();
    const dataL = $content.attr('data-l');
    const subcategoryCount = dataL !== undefined ? parseInt(dataL, 10) || 0 : 0;

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

// ─── Category Page (Album List) Parser ────────────────────────────────────────

/**
 * @typedef {Object} ProductBatch
 * @property {string}   name   - Product/album title
 * @property {string[]} images - Up to MAX_IMAGES_PER_PRODUCT big.jpg URLs
 */

/**
 * Validates that a URL originates from the Yupoo photo CDN.
 * This prevents passing arbitrary external URLs into the download pipeline.
 *
 * @param {string} url
 * @returns {boolean}
 */
const isYupooPhotoUrl = (url) => {
  try {
    const { hostname } = new URL(url);
    return hostname === YUPOO_PHOTO_HOSTNAME;
  } catch {
    return false;
  }
};

/**
 * Replaces any size suffix (small, medium, large, thumb, etc.) in a Yupoo
 * photo URL with "big" to obtain the highest-quality variant.
 *
 * Examples:
 *   https://photo.yupoo.com/user/abc123/small.jpg  → .../big.jpg
 *   https://photo.yupoo.com/user/abc123/medium.jpg → .../big.jpg
 *   https://photo.yupoo.com/user/abc123/big.jpg    → .../big.jpg (unchanged)
 *
 * @param {string} url
 * @returns {string}
 */
const toBigJpgUrl = (url) => {
  // Replace any known size token immediately before .jpg
  return url.replace(
    /\/(small|medium|large|thumb|tiny|normal)(\.jpg)$/i,
    '/big$2'
  );
};

/**
 * Parses a single Yupoo category page HTML and returns an array of
 * ProductBatch objects — one per album/product block found on the page.
 *
 * The page may list many albums; each `.showalbumheader__main` block
 * represents one product. This function does NOT follow pagination;
 * only the first page of results is processed (typically 20–30 albums).
 *
 * Product title is extracted from (in priority order):
 *   1. `span[data-name]` attribute inside `.showalbumheader__gallerytitle`
 *   2. `h1` text content inside `.showalbumheader__main`
 *   3. Fallback: empty string (will be filtered out by the caller)
 *
 * Image URLs are collected from:
 *   `.showalbum__imagecardwrap img[data-src]`
 * and converted to big.jpg variants.
 *
 * @param {string} html - Raw HTML of a Yupoo category page
 * @returns {ProductBatch[]}
 */
const parseCategoryPage = (html) => {
  const $ = cheerio.load(html);
  const products = [];

  // Each album on a category listing page has its header info in
  // .showalbumheader__main and its images in .showalbum__imagecardwrap
  //
  // Note: on a category PAGE (not an album detail page) there will be
  // multiple .showalbumheader__main blocks — one per album listed.
  // However, the .showalbum__imagecardwrap images belong to the full album
  // detail view when viewing a single album.  On the *category listing* page
  // the albums are shown as cards without the full image grid.
  //
  // The HTML provided in the task shows a single-album detail page structure
  // where ALL images are present in one .showalbum__imagecardwrap block.
  // We handle both cases:
  //   A) Category listing page  — multiple .showalbumheader__main, no inline images
  //   B) Album detail page      — one .showalbumheader__main + all images inline

  const $headers = $('.showalbumheader__main');

  if ($headers.length === 0) {
    logger.debug('[yupooService] parseCategoryPage: no .showalbumheader__main found');
    return products;
  }

  if ($headers.length === 1) {
    // ── Case B: single album detail page ─────────────────────────────────
    const $header = $headers.first();

    const title = extractAlbumTitle($, $header);
    if (!title) {
      logger.debug('[yupooService] parseCategoryPage: could not extract album title');
      return products;
    }

    const imageUrls = extractAlbumImages($);

    if (imageUrls.length > 0) {
      products.push({ name: title, images: imageUrls });
    } else {
      logger.debug(`[yupooService] Album "${title}" has no extractable images — skipping`);
    }
  } else {
    // ── Case A: category listing page — multiple album cards ─────────────
    // On listing pages each album card only contains a cover image inside
    // its own .showalbumheader__gallerycover img, NOT the full image grid.
    // We return one ProductBatch per card using whatever images are present.
    $headers.each((_i, headerEl) => {
      const $header = $(headerEl);
      const title = extractAlbumTitle($, $header);
      if (!title) return; // skip unlabelled cards

      // Grab images scoped to this card's parent wrapper
      const $parent = $header.closest('.showalbum__children, .showalbum__parent, [class*="album"]');
      const scopedImages = $parent.length
        ? extractScopedImages($, $parent)
        : [];

      // Fall back to the cover image inside the header block itself
      const coverSrc = $header.find('.showalbumheader__gallerycover img').attr('src') ||
        $header.find('.showalbumheader__gallerycover img').attr('data-src') || '';
      const allImages = scopedImages.length > 0
        ? scopedImages
        : (coverSrc ? [toBigJpgUrl(coverSrc)] : []);

      const validImages = allImages.filter(isYupooPhotoUrl).slice(0, MAX_IMAGES_PER_PRODUCT);

      if (validImages.length > 0) {
        products.push({ name: title, images: validImages });
      }
    });
  }

  logger.info('[yupooService] parseCategoryPage: extracted products', {
    count: products.length,
  });

  return products;
};

/**
 * Extracts the album/product title from a .showalbumheader__main element.
 *
 * Priority:
 *   1. span[data-name] attribute  (most reliable, present in modern Yupoo)
 *   2. h1 text content
 *
 * @param {CheerioStatic} $
 * @param {Cheerio} $header
 * @returns {string} Trimmed title, or empty string if not found
 */
const extractAlbumTitle = ($, $header) => {
  // 1. data-name attribute on the gallery title span
  const dataName = $header.find('[data-name]').first().attr('data-name');
  if (dataName && dataName.trim()) return dataName.trim();

  // 2. h1 text content
  const h1Text = $header.find('h1').first().text().trim();
  if (h1Text) return h1Text;

  return '';
};

/**
 * Collects all big.jpg image URLs from .showalbum__imagecardwrap img[data-src]
 * within the entire page (used for album detail pages).
 *
 * @param {CheerioStatic} $
 * @returns {string[]}
 */
const extractAlbumImages = ($) => {
  const urls = [];
  $('.showalbum__imagecardwrap img[data-src]').each((_i, img) => {
    const dataSrc = $(img).attr('data-src') || '';
    if (!dataSrc) return;
    const bigUrl = toBigJpgUrl(dataSrc);
    if (isYupooPhotoUrl(bigUrl)) {
      urls.push(bigUrl);
    }
  });
  return urls.slice(0, MAX_IMAGES_PER_PRODUCT);
};

/**
 * Collects big.jpg image URLs scoped to a particular DOM element.
 *
 * @param {CheerioStatic} $
 * @param {Cheerio} $scope
 * @returns {string[]}
 */
const extractScopedImages = ($, $scope) => {
  const urls = [];
  $scope.find('img[data-src]').each((_i, img) => {
    const dataSrc = $(img).attr('data-src') || '';
    if (!dataSrc) return;
    const bigUrl = toBigJpgUrl(dataSrc);
    if (isYupooPhotoUrl(bigUrl)) {
      urls.push(bigUrl);
    }
  });
  return urls.slice(0, MAX_IMAGES_PER_PRODUCT);
};

// ─── Duplicate Detection ──────────────────────────────────────────────────────

/**
 * Checks whether a product with the given name already exists in Firestore.
 * Uses a simple equality query on the `name` field.
 *
 * @param {string} productName
 * @returns {Promise<boolean>} true if duplicate found
 */
const productNameExists = async (productName) => {
  const snap = await Product.collection()
    .where('name', '==', productName)
    .limit(1)
    .get();
  return !snap.empty;
};

// ─── Product Creation ─────────────────────────────────────────────────────────

/**
 * Defaults applied to every crawl-imported product.
 * These mirror the architecture design spec and can be overridden by
 * the caller via the `defaults` argument.
 */
const IMPORT_DEFAULTS = {
  kitType: 'home',
  sizes: ['S', 'M', 'L', 'XL', 'XXL'],
  price: 99.99,
  stock: 10,
  customizable: true,
};

/**
 * Creates a single product document in Firestore for a crawled album.
 *
 * Downloads + uploads images, merges defaults, and writes the document.
 * Returns the created product's Firestore ID.
 *
 * @param {ProductBatch} productBatch - { name, images: [externalUrl, ...] }
 * @param {object} [overrideDefaults] - Caller-supplied defaults (price, kitType, etc.)
 * @returns {Promise<string>} New product document ID
 */
const createCrawledProduct = async (productBatch, overrideDefaults = {}) => {
  const { name, images: imageUrls } = productBatch;

  const mergedDefaults = { ...IMPORT_DEFAULTS, ...overrideDefaults };

  // Download & upload images to Firebase Storage
  const storageUrls = await downloadAndUploadImages(imageUrls, {
    maxImages: MAX_IMAGES_PER_PRODUCT,
  });

  const now = admin.firestore.FieldValue.serverTimestamp();
  const productData = {
    name,
    ...mergedDefaults,
    team: null,
    images: storageUrls,
    imageUrl: storageUrls.length > 0 ? storageUrls[0] : null,
    createdAt: now,
    updatedAt: now,
  };

  const ref = Product.collection().doc();
  await ref.set(productData);

  logger.info(`[yupooService] Created product "${name}" (${ref.id}) with ${
    storageUrls.length
  } image(s)`);

  return ref.id;
};

// ─── Main Crawl Orchestrator ──────────────────────────────────────────────────

/**
 * @typedef {Object} CrawlErrorEntry
 * @property {string} category - Category id or name
 * @property {string} product  - Product name (if error occurred during product creation)
 * @property {string} message  - Human-readable error description
 */

/**
 * @typedef {Object} CrawlResult
 * @property {number}           created - Number of products successfully created
 * @property {number}           skipped - Number of products skipped (duplicates)
 * @property {CrawlErrorEntry[]} errors - Per-item error details
 * @property {string[]}         ids    - Firestore IDs of created products
 */

/**
 * Crawls a flat list of category nodes (main categories and/or subcategories),
 * fetches each category page, parses album blocks, and creates products.
 *
 * Algorithm:
 *   1. For each selected category node:
 *      a. Build URL: `${YUPOO_BASE_URL}${node.path}`
 *      b. Optionally append `?isSubCate=true` for subcategories
 *      c. Fetch + parse the page → ProductBatch[]
 *      d. For each ProductBatch:
 *         - Check for duplicate (name match) → skip if found
 *         - createCrawledProduct() → record id
 *      e. Apply polite crawl delay before next category
 *   2. Return aggregated CrawlResult
 *
 * Errors at the category level (fetch failure) are recorded in `errors`
 * and crawling continues with remaining categories.
 * Errors at the product level are similarly recorded and processing continues.
 *
 * @param {Array<{id: string, name: string, path: string, isSubCate?: boolean}>} selectedCategories
 * @param {object} [defaults={}] - Override default product fields
 * @param {Function} [onProgress] - Optional callback(progressInfo) for real-time updates
 * @returns {Promise<CrawlResult>}
 */
const crawlSelectedCategories = async (
  selectedCategories,
  defaults = {},
  onProgress = null
) => {
  const result = {
    created: 0,
    skipped: 0,
    errors: [],
    ids: [],
  };

  const total = selectedCategories.length;
  logger.info(`[yupooService] Starting crawl for ${total} category nodes`, {
    defaults,
  });

  for (let i = 0; i < selectedCategories.length; i++) {
    const category = selectedCategories[i];
    const categoryLabel = `${category.name} (id=${category.id})`;

    if (onProgress) {
      onProgress({ current: i + 1, total, category: category.name, phase: 'fetching' });
    }

    logger.info(`[yupooService] Crawling category ${i + 1}/${total}: ${categoryLabel}`);

    // ── Build URL ────────────────────────────────────────────────────────
    let categoryUrl = `${YUPOO_BASE_URL}${category.path}`;
    if (category.isSubCate) {
      categoryUrl += '?isSubCate=true';
    }

    // ── Fetch + parse category page ──────────────────────────────────────
    let products;
    try {
      const html = await fetchYupooPage(categoryUrl, categoryLabel);
      products = parseCategoryPage(html);
    } catch (err) {
      logger.error(`[yupooService] Failed to crawl category "${categoryLabel}"`, {
        error: err.message,
      });
      result.errors.push({
        category: category.name,
        product: '',
        message: `Failed to fetch/parse category page: ${err.message}`,
      });
      // Still apply delay before next request
      await sleep(randomBetween(CRAWL_DELAY_MIN_MS, CRAWL_DELAY_MAX_MS));
      continue;
    }

    logger.info(`[yupooService] Category "${categoryLabel}" yielded ${products.length} product(s)`);

    // ── Create products ──────────────────────────────────────────────────
    for (const productBatch of products) {
      if (onProgress) {
        onProgress({
          current: i + 1,
          total,
          category: category.name,
          phase: 'creating',
          product: productBatch.name,
        });
      }

      try {
        // Duplicate guard: skip if a product with this exact name already exists
        const isDuplicate = await productNameExists(productBatch.name);
        if (isDuplicate) {
          logger.info(
            `[yupooService] Skipping duplicate product "${productBatch.name}"`
          );
          result.skipped += 1;
          continue;
        }

        // Skip albums with no images (can't create a useful product)
        if (!productBatch.images || productBatch.images.length === 0) {
          logger.warn(
            `[yupooService] Skipping "${productBatch.name}" — no images found`
          );
          result.skipped += 1;
          continue;
        }

        const id = await createCrawledProduct(productBatch, defaults);
        result.created += 1;
        result.ids.push(id);
      } catch (err) {
        logger.error(
          `[yupooService] Error creating product "${productBatch.name}"`,
          { error: err.message, category: category.name }
        );
        result.errors.push({
          category: category.name,
          product: productBatch.name,
          message: err.message,
        });
      }
    }

    // ── Polite delay before next category request ─────────────────────────
    if (i < selectedCategories.length - 1) {
      const delay = randomBetween(CRAWL_DELAY_MIN_MS, CRAWL_DELAY_MAX_MS);
      logger.debug(`[yupooService] Polite crawl delay: ${delay}ms`);
      await sleep(delay);
    }
  }

  logger.info('[yupooService] Crawl complete', {
    created: result.created,
    skipped: result.skipped,
    errors: result.errors.length,
    totalCategories: total,
  });

  return result;
};

// ─── Categories Public API ────────────────────────────────────────────────────

/**
 * Fetches the raw HTML of the Yupoo categories listing page.
 * (Thin wrapper around fetchYupooPage for backwards compatibility.)
 *
 * @returns {Promise<string>}
 */
const fetchCategoriesHtml = () =>
  fetchYupooPage(CATEGORIES_URL, 'categories');

/**
 * Returns the Yupoo category tree.
 *
 * Serves the in-memory cache when available (TTL = 1 hour). Forces a fresh
 * fetch when the cache has expired or when `forceRefresh` is true.
 *
 * @param {object}  [options]
 * @param {boolean} [options.forceRefresh=false] - Bypass cache and re-fetch
 * @returns {Promise<CategoryTree[]>}
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
  crawlSelectedCategories,
  // Exported for unit-testing only
  _parseCategories: parseCategories,
  _extractCategoryId: extractCategoryId,
  _parseCategoryPage: parseCategoryPage,
  _toBigJpgUrl: toBigJpgUrl,
  _isYupooPhotoUrl: isYupooPhotoUrl,
  _extractAlbumTitle: extractAlbumTitle,
};
