/**
 * Unit Tests — CrawlLogger utility
 *
 * Verifies that CrawlLogger emits correctly structured log events
 * via the mocked Winston logger. Does not test Winston internals.
 */

'use strict';

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

jest.mock('../src/utils/logger', () => mockLogger);

const { CrawlLogger, formatDuration, elapsed } = require('../src/utils/crawlLogger');

describe('formatDuration', () => {
  it('formats milliseconds under 1s', () => {
    expect(formatDuration(200)).toBe('200ms');
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats seconds under 1 minute', () => {
    expect(formatDuration(1000)).toBe('1.00s');
    expect(formatDuration(2500)).toBe('2.50s');
    expect(formatDuration(59999)).toBe('59.999s');
  });

  it('formats minutes correctly', () => {
    expect(formatDuration(60000)).toBe('1m 0.00s');
    expect(formatDuration(65000)).toBe('1m 5.00s');
    expect(formatDuration(125000)).toBe('2m 5.00s');
  });
});

describe('elapsed', () => {
  it('returns a non-negative number', () => {
    const start = Date.now();
    const e = elapsed(start);
    expect(e).toBeGreaterThanOrEqual(0);
  });

  it('returns roughly the right elapsed time', () => {
    const start = Date.now() - 100;
    const e = elapsed(start);
    expect(e).toBeGreaterThanOrEqual(90);
    expect(e).toBeLessThan(500);
  });
});

describe('CrawlLogger', () => {
  let clog;

  beforeEach(() => {
    jest.clearAllMocks();
    clog = new CrawlLogger({ jobId: 'test-job-01', userId: 'admin1', totalCategories: 3 });
  });

  it('stores jobId, userId and totalCategories', () => {
    expect(clog.jobId).toBe('test-job-01');
    expect(clog.userId).toBe('admin1');
    expect(clog.totalCategories).toBe(3);
  });

  describe('jobStart()', () => {
    it('emits info log with crawl_job_start event', () => {
      clog.jobStart();
      expect(mockLogger.info).toHaveBeenCalledTimes(1);
      const [msg, meta] = mockLogger.info.mock.calls[0];
      expect(msg).toContain('test-job-01');
      expect(msg).toContain('START');
      expect(meta.event).toBe('crawl_job_start');
      expect(meta.jobId).toBe('test-job-01');
      expect(meta.totalCategories).toBe(3);
    });
  });

  describe('jobDone()', () => {
    it('emits info log when no errors', () => {
      clog.jobDone({ created: 5, skipped: 1, errors: 0, ids: [] });
      expect(mockLogger.info).toHaveBeenCalledTimes(1);
      const [, meta] = mockLogger.info.mock.calls[0];
      expect(meta.event).toBe('crawl_job_done');
      expect(meta.created).toBe(5);
      expect(meta.skipped).toBe(1);
      expect(meta.errorCount).toBe(0);
    });

    it('emits warn log when there are errors', () => {
      clog.jobDone({ created: 2, skipped: 0, errors: 3, ids: [] });
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      const [, meta] = mockLogger.warn.mock.calls[0];
      expect(meta.event).toBe('crawl_job_done');
      expect(meta.errorCount).toBe(3);
    });
  });

  describe('categoryStart()', () => {
    it('emits info log with category metadata', () => {
      clog.categoryStart({ id: '123', name: 'La Liga' }, 1);
      expect(mockLogger.info).toHaveBeenCalledTimes(1);
      const [msg, meta] = mockLogger.info.mock.calls[0];
      expect(msg).toContain('La Liga');
      expect(meta.event).toBe('crawl_category_start');
      expect(meta.categoryId).toBe('123');
      expect(meta.index).toBe(1);
      expect(meta.total).toBe(3);
    });
  });

  describe('categoryFetched()', () => {
    it('emits info log with bytes and duration', () => {
      clog.categoryFetched({ id: '123', name: 'La Liga' }, { bytes: 45000, attempt: 1, durationMs: 320 });
      const [, meta] = mockLogger.info.mock.calls[0];
      expect(meta.event).toBe('crawl_category_fetched');
      expect(meta.responseBytes).toBe(45000);
      expect(meta.durationMs).toBe(320);
    });
  });

  describe('categoryParsed()', () => {
    it('emits info log when products found', () => {
      clog.categoryParsed({ id: '1', name: 'La Liga' }, { productCount: 3 });
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('emits warn log when no products found', () => {
      clog.categoryParsed({ id: '1', name: 'Empty Cat' }, { productCount: 0 });
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('categoryFailed()', () => {
    it('emits error log with error type', () => {
      const err = new Error('Connection timed out');
      clog.categoryFailed({ id: '1', name: 'La Liga' }, err, { errorType: 'timeout', retryable: true });
      const [msg, meta] = mockLogger.error.mock.calls[0];
      expect(msg).toContain('FAILED');
      expect(meta.event).toBe('crawl_category_failed');
      expect(meta.errorType).toBe('timeout');
      expect(meta.retryable).toBe(true);
    });
  });

  describe('categoryRetrying()', () => {
    it('emits warn log with retry details', () => {
      clog.categoryRetrying(
        { id: '1', name: 'La Liga' },
        { attempt: 1, maxAttempts: 3, delayMs: 500, reason: 'timeout' }
      );
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      const [, meta] = mockLogger.warn.mock.calls[0];
      expect(meta.event).toBe('crawl_category_retry');
      expect(meta.attempt).toBe(1);
      expect(meta.delayMs).toBe(500);
    });
  });

  describe('circuitOpen()', () => {
    it('emits error log when circuit breaker trips', () => {
      clog.circuitOpen(5, 5);
      const [msg, meta] = mockLogger.error.mock.calls[0];
      expect(msg).toContain('CIRCUIT BREAKER');
      expect(meta.event).toBe('crawl_circuit_breaker_open');
      expect(meta.consecutiveFailures).toBe(5);
    });
  });

  describe('productCreated()', () => {
    it('emits info log with product details', () => {
      clog.productCreated(
        { name: 'La Liga' },
        'Real Madrid Jersey',
        { id: 'doc123', imageCount: 5, durationMs: 800 }
      );
      const [msg, meta] = mockLogger.info.mock.calls[0];
      expect(msg).toContain('CREATED');
      expect(meta.event).toBe('crawl_product_created');
      expect(meta.productId).toBe('doc123');
      expect(meta.imageCount).toBe(5);
    });
  });

  describe('productSkipped()', () => {
    it('emits info log with skip reason', () => {
      clog.productSkipped({ name: 'La Liga' }, 'Real Madrid Jersey', 'duplicate');
      const [, meta] = mockLogger.info.mock.calls[0];
      expect(meta.event).toBe('crawl_product_skipped');
      expect(meta.reason).toBe('duplicate');
    });
  });

  describe('productFailed()', () => {
    it('emits error log with error details', () => {
      const err = new Error('Upload failed');
      clog.productFailed({ name: 'La Liga' }, 'Barca Jersey', err);
      const [msg, meta] = mockLogger.error.mock.calls[0];
      expect(msg).toContain('FAILED product');
      expect(meta.event).toBe('crawl_product_failed');
      expect(meta.errorMessage).toBe('Upload failed');
    });
  });

  describe('imagesUploaded()', () => {
    it('emits info when all images succeed', () => {
      clog.imagesUploaded('Real Madrid Jersey', { requested: 5, uploaded: 5, durationMs: 400 });
      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('emits warn when some images fail', () => {
      clog.imagesUploaded('Real Madrid Jersey', { requested: 5, uploaded: 3, durationMs: 400 });
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('emits error when all images fail', () => {
      clog.imagesUploaded('Real Madrid Jersey', { requested: 5, uploaded: 0, durationMs: 400 });
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('crawlDelay()', () => {
    it('emits debug log with delay amount', () => {
      clog.crawlDelay(750);
      const [, meta] = mockLogger.debug.mock.calls[0];
      expect(meta.event).toBe('crawl_polite_delay');
      expect(meta.delayMs).toBe(750);
    });
  });
});
