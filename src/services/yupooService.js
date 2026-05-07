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
 * Error handling:
 *   - Network errors are classified by type (timeout, rate_limit, server_error, etc.)
 *   - Axios errors are wrapped with actionable context before being re-thrown
 *   - A circuit breaker halts the crawl when too many consecutive category
 *     failures occur (prevents wasting time & resources on a broken session)
 *   - Partial image-upload failures on product creation are cleaned up
 *     automatically to avoid orphaned Storage objects
 *
 * Caching:
 *   Parsed category results are stored in-memory for CACHE_TTL_MS (1 hour)
 *   to avoid hitting the external Yupoo server on every admin request.
 *
 * Retry logic:
 *   Up to MAX_RETRIES attempts with exponential-backoff-plus-jitter between
 *   tries to handle transient network errors gracefully.
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

const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const { admin } = require('./db');
const Product = require('../models/Product');
const { downloadAndUploadImages, deleteProductImages } = require('./upload');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { CrawlLogger } = require('../utils/crawlLogger');

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

/**
 * Retry configuration:
 *  - MAX_RETRIES: maximum number of attempts (first try + retries)
 *  - RETRY_BASE_DELAY_MS: base delay; actual delay = base * 2^(attempt-1) + jitter
 *  - RETRY_MAX_DELAY_MS: cap on the computed backoff delay
 */
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 5_000;

/**
 * Polite crawl delay range (ms). A random value between MIN and MAX is
 * awaited between consecutive category-page requests to avoid hammering
 * the Yupoo server.
 */
const CRAWL_DELAY_MIN_MS = 500;
const CRAWL_DELAY_MAX_MS = 1_200;

/** Maximum images to collect per product album. */
const MAX_IMAGES_PER_PRODUCT = 10;

/**
 * Circuit-breaker threshold: if this many consecutive category fetches fail,
 * the crawl is aborted early with an error entry in the result.
 */
const CIRCUIT_BREAKER_THRESHOLD = 5;

/**
 * HTTP status codes from Yupoo that should NOT be retried
 * (client errors indicating a permanent failure for this URL).
 */
const NON_RETRYABLE_HTTP_STATUSES = new Set([400, 401, 403, 404, 410]);

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

// ─── HTTP / Error Helpers ──────────────────────────────────────────────────────

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
 * Computes the next retry delay using exponential backoff with full jitter.
 *
 * Formula: min(cap, random(0, base * 2^attempt))
 *
 * @param {number} attempt - The failed attempt number (1-based)
 * @returns {number} Delay in milliseconds
 */
const backoffDelay = (attempt) => {
  const exponential = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  const capped = Math.min(exponential, RETRY_MAX_DELAY_MS);
  // Full-jitter: pick random value between 0 and capped
  return Math.floor(Math.random() * capped);
};

/**
 * Error type classification for Yupoo fetch failures.
 *
 * Used in structured log entries and crawl error reports so that operators
 * can distinguish transient network issues from policy-based blocks.
 *
 * @readonly
 * @enum {string}
 */
const FetchErrorType = {
  TIMEOUT: 'timeout',
  RATE_LIMITED: 'rate_limited',
  SERVER_ERROR: 'server_error',
  CLIENT_ERROR: 'client_error',
  NETWORK: 'network',
  INVALID_RESPONSE: 'invalid_response',
  UNKNOWN: 'unknown',
};

/**
 * Classifies an axios (or generic) error into a FetchErrorType value.
 * Also determines whether the error is retryable.
 *
 * Retryable:
 *   - TIMEOUT           (transient; server may accept on retry)
 *   - NETWORK           (DNS, connection refused; may be transient)
 *   - SERVER_ERROR      (5xx; server-side issue that may clear)
 *   - RATE_LIMITED      (429; only after applying required backoff)
 *
 * NOT retryable:
 *   - CLIENT_ERROR      (4xx except 429; permanent failure for this URL)
 *   - INVALID_RESPONSE  (unexpected Content-Type; won't improve on retry)
 *   - UNKNOWN           (not classified; treat as non-retryable for safety)
 *
 * @param {Error} err
 * @returns {{ type: string, retryable: boolean, httpStatus: number|null }}
 */
const classifyFetchError = (err) => {
  // Axios errors have a `.code` property for network-level issues
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
    return { type: FetchErrorType.TIMEOUT, retryable: true, httpStatus: null };
  }

  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
    return { type: FetchErrorType.NETWORK, retryable: true, httpStatus: null };
  }

  if (err.response) {
    const status = err.response.status;

    if (status === 429) {
      return { type: FetchErrorType.RATE_LIMITED, retryable: true, httpStatus: status };
    }
    if (status >= 500) {
      return { type: FetchErrorType.SERVER_ERROR, retryable: true, httpStatus: status };
    }
    if (status >= 400) {
      return { type: FetchErrorType.CLIENT_ERROR, retryable: false, httpStatus: status };
    }
  }

  // AppError thrown by fetchYupooPage for unexpected Content-Type
  if (err instanceof AppError && err.statusCode === 502) {
    return { type: FetchErrorType.INVALID_RESPONSE, retryable: false, httpStatus: null };
  }

  return { type: FetchErrorType.UNKNOWN, retryable: false, httpStatus: null };
};

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
  'Cache-Control': 'no-cache',
};

/**
 * Fetches a Yupoo HTML page with exponential-backoff retry logic.
 *
 * Retries are only applied to retryable error types (see classifyFetchError).
 * Each retry waits for backoffDelay(attempt) ms before the next attempt.
 *
 * @param {string} url   - Full URL to fetch
 * @param {string} [label] - Human-readable label used in log messages
 * @param {object} [opts]
 * @param {CrawlLogger|null} [opts.clog]     - Optional CrawlLogger for detailed retry events
 * @param {{ id: string, name: string }|null} [opts.category] - Category context for logging
 * @returns {Promise<{ html: string, bytes: number, attempt: number, durationMs: number }>}
 * @throws {AppError} When all retries are exhausted or a non-retryable error occurs
 */
const fetchYupooPage = async (url, label = url, opts = {}) => {
  const { clog = null, category = null } = opts;
  let lastError;
  let lastClassification = null;
  const fetchStart = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const attemptStart = Date.now();
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

      const html = response.data;
      const bytes = typeof html === 'string' ? html.length : 0;
      const durationMs = Date.now() - attemptStart;

      logger.info(`[yupooService] Fetched "${label}" successfully`, {
        bytes,
        attempt,
        durationMs,
      });

      return { html, bytes, attempt, durationMs };
    } catch (err) {
      lastError = err;
      lastClassification = classifyFetchError(err);
      const attemptDuration = Date.now() - attemptStart;

      // Non-retryable errors — stop immediately
      if (!lastClassification.retryable) {
        logger.error(
          `[yupooService] Non-retryable error (${lastClassification.type}) ` +
          `fetching "${label}" after ${attemptDuration}ms — ${err.message}`
        );
        break;
      }

      // Check if we've also hit a Yupoo client-error HTTP code
      if (
        lastClassification.httpStatus &&
        NON_RETRYABLE_HTTP_STATUSES.has(lastClassification.httpStatus)
      ) {
        logger.error(
          `[yupooService] HTTP ${lastClassification.httpStatus} (permanent) ` +
          `fetching "${label}" — not retrying`
        );
        break;
      }

      if (attempt < MAX_RETRIES) {
        const delay = backoffDelay(attempt);
        const reason = `${lastClassification.type}${
          lastClassification.httpStatus ? ` (HTTP ${lastClassification.httpStatus})` : ''
        }: ${err.message}`;

        if (clog && category) {
          clog.categoryRetrying(category, {
            attempt,
            maxAttempts: MAX_RETRIES,
            delayMs: delay,
            reason,
          });
        } else {
          logger.warn(
            `[yupooService] Fetch attempt ${attempt} failed (${lastClassification.type}); ` +
            `retrying in ${delay}ms — ${err.message}`
          );
        }
        await sleep(delay);
      }
    }
  }

  const totalDuration = Date.now() - fetchStart;
  logger.error(
    `[yupooService] All fetch attempts failed for "${label}" ` +
    `(${totalDuration}ms total)`,
    { url, error: lastError && lastError.message, classification: lastClassification }
  );

  if (lastError instanceof AppError) throw lastError;

  const errorType = lastClassification ? lastClassification.type : FetchErrorType.UNKNOWN;
  const httpStatus = lastClassification ? lastClassification.httpStatus : null;

  const msg =
    `Failed to fetch Yupoo page "${label}" after ${MAX_RETRIES} attempts ` +
    `[${errorType}${httpStatus ? ` HTTP ${httpStatus}` : ''}]: ` +
    (lastError ? lastError.message : 'unknown error');

  throw new AppError(msg, 502);
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
 * If the Firestore write fails after images have been uploaded, the uploaded
 * Storage objects are deleted to prevent orphaned files.
 *
 * @param {ProductBatch} productBatch - { name, images: [externalUrl, ...] }
 * @param {object} [overrideDefaults] - Caller-supplied defaults (price, kitType, etc.)
 * @param {CrawlLogger|null} [clog]   - Optional CrawlLogger for structured progress logging
 * @returns {Promise<{ id: string, imageCount: number }>}
 */
const createCrawledProduct = async (productBatch, overrideDefaults = {}, clog = null) => {
  const { name, images: imageUrls } = productBatch;

  const mergedDefaults = { ...IMPORT_DEFAULTS, ...overrideDefaults };

  // ── Download & upload images ──────────────────────────────────────────────
  const imageStart = Date.now();
  let storageUrls = [];

  try {
    storageUrls = await downloadAndUploadImages(imageUrls, {
      maxImages: MAX_IMAGES_PER_PRODUCT,
    });
  } catch (uploadErr) {
    // downloadAndUploadImages throws AppError(422) when ALL images fail.
    // Re-throw as-is; the caller will handle cleanup.
    throw uploadErr;
  }

  const imageDurationMs = Date.now() - imageStart;

  if (clog) {
    clog.imagesUploaded(name, {
      requested: imageUrls.length,
      uploaded: storageUrls.length,
      durationMs: imageDurationMs,
    });
  }

  // ── Persist to Firestore ──────────────────────────────────────────────────
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

  let ref;
  try {
    ref = Product.collection().doc();
    await ref.set(productData);
  } catch (writeErr) {
    // Firestore write failed — clean up the already-uploaded Storage images
    // to avoid orphaned objects accumulating in the bucket.
    if (storageUrls.length > 0) {
      logger.warn(
        `[yupooService] Firestore write failed for "${name}"; ` +
        `cleaning up ${storageUrls.length} uploaded image(s)`,
        { error: writeErr.message }
      );
      // Best-effort cleanup (non-blocking; failures are logged inside deleteProductImages)
      deleteProductImages(storageUrls).catch((cleanupErr) => {
        logger.error(
          `[yupooService] Storage cleanup failed for "${name}": ${cleanupErr.message}`
        );
      });
    }
    throw writeErr;
  }

  logger.info(
    `[yupooService] Created product "${name}" (${ref.id}) with ${storageUrls.length} image(s)`
  );

  return { id: ref.id, imageCount: storageUrls.length };
};

// ─── Main Crawl Orchestrator ──────────────────────────────────────────────────

/**
 * @typedef {Object} CrawlErrorEntry
 * @property {string} category - Category id or name
 * @property {string} product  - Product name (if error occurred during product creation)
 * @property {string} message  - Human-readable error description
 * @property {string} [errorType] - Classified error type for programmatic handling
 */

/**
 * @typedef {Object} CrawlResult
 * @property {number}             created    - Number of products successfully created
 * @property {number}             skipped    - Number of products skipped (duplicates)
 * @property {CrawlErrorEntry[]}  errors     - Per-item error details
 * @property {string[]}           ids        - Firestore IDs of created products
 * @property {number}             durationMs - Total crawl duration in ms
 * @property {boolean}            aborted    - true if circuit breaker triggered
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
 * Circuit breaker:
 *   If CIRCUIT_BREAKER_THRESHOLD consecutive category fetches fail, the crawl
 *   is aborted and the result includes `aborted: true`.
 *
 * Errors at the category level (fetch failure) are recorded in `errors`
 * and crawling continues with remaining categories (unless circuit trips).
 * Errors at the product level are similarly recorded and processing continues.
 *
 * @param {Array<{id: string, name: string, path: string, isSubCate?: boolean}>} selectedCategories
 * @param {object} [defaults={}] - Override default product fields
 * @param {object} [crawlOpts={}]
 * @param {string} [crawlOpts.jobId]  - Job ID for log correlation (auto-generated if omitted)
 * @param {string} [crawlOpts.userId] - Admin user ID for log correlation
 * @returns {Promise<CrawlResult>}
 */
const crawlSelectedCategories = async (
  selectedCategories,
  defaults = {},
  crawlOpts = {}
) => {
  const jobId = crawlOpts.jobId || crypto.randomUUID().slice(0, 8);
  const userId = crawlOpts.userId || 'unknown';
  const total = selectedCategories.length;

  const result = {
    created: 0,
    skipped: 0,
    errors: [],
    ids: [],
    durationMs: 0,
    aborted: false,
  };

  const clog = new CrawlLogger({ jobId, userId, totalCategories: total });
  const jobStart = Date.now();
  clog.jobStart();

  logger.info(`[yupooService] Starting crawl job ${jobId} for ${total} category nodes`, {
    defaults,
    userId,
  });

  let consecutiveFailures = 0;

  for (let i = 0; i < selectedCategories.length; i++) {
    const category = selectedCategories[i];
    const categoryLabel = `${category.name} (id=${category.id})`;
    const categoryStart = Date.now();

    // ── Circuit breaker check ─────────────────────────────────────────────
    if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      clog.circuitOpen(consecutiveFailures, CIRCUIT_BREAKER_THRESHOLD);
      result.errors.push({
        category: category.name,
        product: '',
        message:
          `Crawl aborted: ${consecutiveFailures} consecutive category failures ` +
          `exceeded the circuit-breaker threshold (${CIRCUIT_BREAKER_THRESHOLD}).`,
        errorType: 'circuit_breaker',
      });
      result.aborted = true;
      break;
    }

    clog.categoryStart(category, i + 1);

    // ── Build URL ────────────────────────────────────────────────────────
    let categoryUrl = `${YUPOO_BASE_URL}${category.path}`;
    if (category.isSubCate) {
      categoryUrl += '?isSubCate=true';
    }

    // ── Fetch + parse category page ──────────────────────────────────────
    let products;
    try {
      const fetchResult = await fetchYupooPage(categoryUrl, categoryLabel, {
        clog,
        category,
      });

      clog.categoryFetched(category, {
        bytes: fetchResult.bytes,
        attempt: fetchResult.attempt,
        durationMs: fetchResult.durationMs,
      });

      products = parseCategoryPage(fetchResult.html);

      clog.categoryParsed(category, { productCount: products.length });

      // Reset circuit breaker on successful fetch
      consecutiveFailures = 0;
    } catch (err) {
      const classification = classifyFetchError(err);
      consecutiveFailures += 1;

      clog.categoryFailed(category, err, {
        errorType: classification.type,
        retryable: classification.retryable,
      });

      result.errors.push({
        category: category.name,
        product: '',
        message: `Failed to fetch/parse category page: ${err.message}`,
        errorType: classification.type,
      });

      // Still apply delay before next request (even on failure)
      await sleep(randomBetween(CRAWL_DELAY_MIN_MS, CRAWL_DELAY_MAX_MS));
      continue;
    }

    logger.info(
      `[yupooService] Category "${categoryLabel}" yielded ${products.length} product(s)`
    );

    // ── Create products ──────────────────────────────────────────────────
    let catCreated = 0;
    let catSkipped = 0;
    let catErrors = 0;

    for (const productBatch of products) {
      const productStart = Date.now();
      try {
        // Duplicate guard: skip if a product with this exact name already exists
        const isDuplicate = await productNameExists(productBatch.name);
        if (isDuplicate) {
          clog.productSkipped(category, productBatch.name, 'duplicate');
          result.skipped += 1;
          catSkipped += 1;
          continue;
        }

        // Skip albums with no images (can't create a useful product)
        if (!productBatch.images || productBatch.images.length === 0) {
          clog.productSkipped(category, productBatch.name, 'no_images');
          result.skipped += 1;
          catSkipped += 1;
          continue;
        }

        const { id, imageCount } = await createCrawledProduct(
          productBatch,
          defaults,
          clog
        );

        const productDurationMs = Date.now() - productStart;
        clog.productCreated(category, productBatch.name, {
          id,
          imageCount,
          durationMs: productDurationMs,
        });

        result.created += 1;
        result.ids.push(id);
        catCreated += 1;
      } catch (err) {
        catErrors += 1;
        clog.productFailed(category, productBatch.name, err);
        result.errors.push({
          category: category.name,
          product: productBatch.name,
          message: err.message,
          errorType:
            err instanceof AppError
              ? (err.statusCode >= 500 ? 'server_error' : 'client_error')
              : 'unknown',
        });
      }
    }

    const categoryDurationMs = Date.now() - categoryStart;
    clog.categoryDone(category, {
      created: catCreated,
      skipped: catSkipped,
      errors: catErrors,
      durationMs: categoryDurationMs,
    });

    // ── Polite delay before next category request ─────────────────────────
    if (i < selectedCategories.length - 1) {
      const delay = randomBetween(CRAWL_DELAY_MIN_MS, CRAWL_DELAY_MAX_MS);
      clog.crawlDelay(delay);
      await sleep(delay);
    }
  }

  result.durationMs = Date.now() - jobStart;
  clog.jobDone({
    created: result.created,
    skipped: result.skipped,
    errors: result.errors.length,
    ids: result.ids,
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
const fetchCategoriesHtml = async () => {
  const { html } = await fetchYupooPage(CATEGORIES_URL, 'categories');
  return html;
};

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
  _classifyFetchError: classifyFetchError,
  _FetchErrorType: FetchErrorType,
  _backoffDelay: backoffDelay,
  _CIRCUIT_BREAKER_THRESHOLD: CIRCUIT_BREAKER_THRESHOLD,
};
