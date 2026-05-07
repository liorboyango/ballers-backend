/**
 * CrawlLogger — Structured progress logger for supplier crawl operations.
 *
 * Wraps Winston to emit consistently-shaped log entries for each stage of
 * a crawl job: job start/end, per-category fetch/parse/create phases, and
 * per-product upload/write steps.
 *
 * This is NOT a general-purpose utility — it is tightly coupled to the
 * supplier crawl workflow. Its primary purpose is to make the crawl observable
 * from log aggregation tools (e.g. Google Cloud Logging) without drowning
 * application logs in ad-hoc `logger.info()` calls.
 *
 * Usage:
 * ```js
 * const { CrawlLogger } = require('../utils/crawlLogger');
 * const clog = new CrawlLogger({ jobId: 'abc', userId: 'admin1', totalCategories: 5 });
 *
 * clog.jobStart();
 * clog.categoryStart(category, 1);
 * clog.categoryFetched(category, { bytes: 45000, attempt: 1, durationMs: 320 });
 * clog.categoryParsed(category, { productCount: 4 });
 * clog.productSkipped(category, productName, 'duplicate');
 * clog.productCreated(category, productName, { id: 'xyz', imageCount: 3, durationMs: 800 });
 * clog.productFailed(category, productName, error);
 * clog.categoryDone(category, { created: 3, skipped: 1, errors: 0, durationMs: 2100 });
 * clog.jobDone(result);
 * ```
 */

'use strict';

const logger = require('./logger');

/**
 * Returns elapsed milliseconds since the given start time (from Date.now()).
 * @param {number} startMs
 * @returns {number}
 */
const elapsed = (startMs) => Date.now() - startMs;

/**
 * Formats a duration in milliseconds to a human-readable string.
 * Examples: 320 → "320ms", 2500 → "2.50s", 65000 → "1m 5.00s"
 *
 * @param {number} ms
 * @returns {string}
 */
const formatDuration = (ms) => {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(2)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = (seconds % 60).toFixed(2);
  return `${minutes}m ${remainingSecs}s`;
};

/**
 * CrawlLogger provides structured logging for a single crawl job session.
 *
 * Each log entry includes:
 *  - `event`: machine-readable event name (e.g. 'crawl_job_start')
 *  - `jobId`: unique identifier for the crawl run
 *  - `userId`: admin user who triggered the crawl
 *  - Contextual fields (category, product, timing, counts)
 *
 * All log entries are emitted at INFO level except errors (ERROR level).
 */
class CrawlLogger {
  /**
   * @param {object} opts
   * @param {string} opts.jobId          - Unique ID for this crawl run
   * @param {string} [opts.userId]       - Admin user who triggered the crawl
   * @param {number} opts.totalCategories - Total categories in this job
   */
  constructor({ jobId, userId = 'unknown', totalCategories }) {
    this.jobId = jobId;
    this.userId = userId;
    this.totalCategories = totalCategories;
    this._jobStart = Date.now();
  }

  /**
   * Base metadata attached to every log entry.
   * @returns {object}
   */
  _base(extra = {}) {
    return {
      jobId: this.jobId,
      userId: this.userId,
      ...extra,
    };
  }

  // ─── Job-level events ─────────────────────────────────────────────────────

  /**
   * Emitted once when the crawl job begins.
   */
  jobStart() {
    logger.info(
      `[CrawlJob:${this.jobId}] START — ${this.totalCategories} categories to crawl`,
      this._base({
        event: 'crawl_job_start',
        totalCategories: this.totalCategories,
      })
    );
  }

  /**
   * Emitted once when the crawl job finishes (success or partial failure).
   *
   * @param {object} result
   * @param {number} result.created
   * @param {number} result.skipped
   * @param {number} result.errors  - error count (integer)
   * @param {string[]} result.ids
   */
  jobDone(result) {
    const durationMs = elapsed(this._jobStart);
    const level = result.errors > 0 ? 'warn' : 'info';

    logger[level](
      `[CrawlJob:${this.jobId}] DONE — ` +
      `created=${result.created} skipped=${result.skipped} errors=${result.errors} ` +
      `(${formatDuration(durationMs)})`,
      this._base({
        event: 'crawl_job_done',
        created: result.created,
        skipped: result.skipped,
        errorCount: result.errors,
        durationMs,
      })
    );
  }

  /**
   * Emitted when the circuit breaker trips and the job is aborted early.
   *
   * @param {number} consecutiveFailures
   * @param {number} threshold
   */
  circuitOpen(consecutiveFailures, threshold) {
    logger.error(
      `[CrawlJob:${this.jobId}] CIRCUIT BREAKER OPEN — ` +
      `${consecutiveFailures} consecutive failures (threshold: ${threshold}). Aborting crawl.`,
      this._base({
        event: 'crawl_circuit_breaker_open',
        consecutiveFailures,
        threshold,
      })
    );
  }

  // ─── Category-level events ─────────────────────────────────────────────────

  /**
   * Emitted when we begin processing a category.
   *
   * @param {{ id: string, name: string }} category
   * @param {number} index - 1-based index
   */
  categoryStart(category, index) {
    logger.info(
      `[CrawlJob:${this.jobId}] [${index}/${this.totalCategories}] ` +
      `Fetching category "${category.name}" (id=${category.id})`,
      this._base({
        event: 'crawl_category_start',
        categoryId: category.id,
        categoryName: category.name,
        index,
        total: this.totalCategories,
      })
    );
  }

  /**
   * Emitted when the category page HTML has been successfully fetched.
   *
   * @param {{ id: string, name: string }} category
   * @param {object} opts
   * @param {number} opts.bytes       - Response size in bytes
   * @param {number} opts.attempt     - Which retry attempt succeeded (1=first try)
   * @param {number} opts.durationMs  - Time spent fetching (ms)
   */
  categoryFetched(category, { bytes, attempt, durationMs }) {
    logger.info(
      `[CrawlJob:${this.jobId}] Fetched "${category.name}" — ` +
      `${bytes}B in ${formatDuration(durationMs)} (attempt ${attempt})`,
      this._base({
        event: 'crawl_category_fetched',
        categoryId: category.id,
        categoryName: category.name,
        responseBytes: bytes,
        attempt,
        durationMs,
      })
    );
  }

  /**
   * Emitted when the category page has been parsed into product batches.
   *
   * @param {{ id: string, name: string }} category
   * @param {object} opts
   * @param {number} opts.productCount - Number of product batches found
   */
  categoryParsed(category, { productCount }) {
    const level = productCount === 0 ? 'warn' : 'info';
    logger[level](
      `[CrawlJob:${this.jobId}] Parsed "${category.name}" — ${productCount} product(s) found`,
      this._base({
        event: 'crawl_category_parsed',
        categoryId: category.id,
        categoryName: category.name,
        productCount,
      })
    );
  }

  /**
   * Emitted when a category fetch/parse fails.
   *
   * @param {{ id: string, name: string }} category
   * @param {Error} err
   * @param {object} [opts]
   * @param {string} [opts.errorType]   - Classified error type (timeout, rate_limit, etc.)
   * @param {boolean} [opts.retryable]  - Whether this error is retryable
   */
  categoryFailed(category, err, { errorType = 'unknown', retryable = false } = {}) {
    logger.error(
      `[CrawlJob:${this.jobId}] FAILED category "${category.name}" ` +
      `(${errorType}${retryable ? ', retryable' : ''}) — ${err.message}`,
      this._base({
        event: 'crawl_category_failed',
        categoryId: category.id,
        categoryName: category.name,
        errorType,
        retryable,
        errorMessage: err.message,
        errorCode: err.code || null,
        httpStatus: (err.response && err.response.status) || null,
      })
    );
  }

  /**
   * Emitted when a retry attempt is about to happen for a category fetch.
   *
   * @param {{ id: string, name: string }} category
   * @param {object} opts
   * @param {number} opts.attempt      - Attempt number that just failed (1-based)
   * @param {number} opts.maxAttempts
   * @param {number} opts.delayMs      - Delay before next attempt
   * @param {string} opts.reason       - Short reason for failure
   */
  categoryRetrying(category, { attempt, maxAttempts, delayMs, reason }) {
    logger.warn(
      `[CrawlJob:${this.jobId}] Retry ${attempt}/${maxAttempts} for "${category.name}" ` +
      `in ${formatDuration(delayMs)} (${reason})`,
      this._base({
        event: 'crawl_category_retry',
        categoryId: category.id,
        categoryName: category.name,
        attempt,
        maxAttempts,
        delayMs,
        reason,
      })
    );
  }

  /**
   * Emitted when we are about to apply a polite delay between categories.
   *
   * @param {number} delayMs
   */
  crawlDelay(delayMs) {
    logger.debug(
      `[CrawlJob:${this.jobId}] Polite delay: ${formatDuration(delayMs)}`,
      this._base({ event: 'crawl_polite_delay', delayMs })
    );
  }

  /**
   * Emitted when a category processing batch is complete.
   *
   * @param {{ id: string, name: string }} category
   * @param {object} opts
   * @param {number} opts.created
   * @param {number} opts.skipped
   * @param {number} opts.errors
   * @param {number} opts.durationMs
   */
  categoryDone(category, { created, skipped, errors, durationMs }) {
    const level = errors > 0 ? 'warn' : 'info';
    logger[level](
      `[CrawlJob:${this.jobId}] DONE category "${category.name}" — ` +
      `created=${created} skipped=${skipped} errors=${errors} ` +
      `(${formatDuration(durationMs)})`,
      this._base({
        event: 'crawl_category_done',
        categoryId: category.id,
        categoryName: category.name,
        created,
        skipped,
        errors,
        durationMs,
      })
    );
  }

  // ─── Product-level events ──────────────────────────────────────────────────

  /**
   * Emitted when a product is skipped (duplicate or no images).
   *
   * @param {{ name: string }} category
   * @param {string} productName
   * @param {'duplicate'|'no_images'|string} reason
   */
  productSkipped(category, productName, reason) {
    logger.info(
      `[CrawlJob:${this.jobId}] SKIP "${productName}" (${reason})`,
      this._base({
        event: 'crawl_product_skipped',
        categoryName: category.name,
        productName,
        reason,
      })
    );
  }

  /**
   * Emitted when a product is created successfully.
   *
   * @param {{ name: string }} category
   * @param {string} productName
   * @param {object} opts
   * @param {string} opts.id         - Firestore document ID
   * @param {number} opts.imageCount - Number of uploaded images
   * @param {number} opts.durationMs - Time taken to create the product
   */
  productCreated(category, productName, { id, imageCount, durationMs }) {
    logger.info(
      `[CrawlJob:${this.jobId}] CREATED "${productName}" ` +
      `(id=${id}, images=${imageCount}, ${formatDuration(durationMs)})`,
      this._base({
        event: 'crawl_product_created',
        categoryName: category.name,
        productName,
        productId: id,
        imageCount,
        durationMs,
      })
    );
  }

  /**
   * Emitted when creating a product fails.
   *
   * @param {{ name: string }} category
   * @param {string} productName
   * @param {Error} err
   */
  productFailed(category, productName, err) {
    logger.error(
      `[CrawlJob:${this.jobId}] FAILED product "${productName}" — ${err.message}`,
      this._base({
        event: 'crawl_product_failed',
        categoryName: category.name,
        productName,
        errorMessage: err.message,
        errorCode: err.code || null,
      })
    );
  }

  /**
   * Emitted when image downloads complete (before Firestore write).
   *
   * @param {string} productName
   * @param {object} opts
   * @param {number} opts.requested  - Number of images requested
   * @param {number} opts.uploaded   - Number successfully uploaded
   * @param {number} opts.durationMs - Download+upload duration
   */
  imagesUploaded(productName, { requested, uploaded, durationMs }) {
    const level = uploaded === 0 ? 'error' : uploaded < requested ? 'warn' : 'info';
    logger[level](
      `[CrawlJob:${this.jobId}] Images for "${productName}": ` +
      `${uploaded}/${requested} uploaded (${formatDuration(durationMs)})`,
      this._base({
        event: 'crawl_images_uploaded',
        productName,
        requested,
        uploaded,
        durationMs,
      })
    );
  }
}

module.exports = { CrawlLogger, formatDuration, elapsed };
