/**
 * Unit Tests — Yupoo Service (error handling, parsing, rate limiting, logging)
 *
 * These tests cover:
 *   1. HTML parsers (_parseCategories, _parseCategoryPage, _toBigJpgUrl, etc.)
 *   2. Error classification (_classifyFetchError)
 *   3. Exponential backoff (_backoffDelay)
 *   4. Circuit-breaker constant exposed via _CIRCUIT_BREAKER_THRESHOLD
 *   5. Duplicate URL conversion (_toBigJpgUrl)
 *   6. URL validation (_isYupooPhotoUrl)
 *
 * No real network or Firestore calls are made — all external dependencies
 * are mocked with jest.mock().
 */

'use strict';

// ── Mocks (must come BEFORE require of the module under test) ──────────────────

jest.mock('firebase-admin', () => {
  const firestoreFn = () => ({
    settings: () => {},
    collection: () => ({
      doc: () => ({ set: jest.fn().mockResolvedValue(undefined) }),
      where: () => ({
        limit: () => ({ get: jest.fn().mockResolvedValue({ empty: true }) }),
      }),
    }),
  });
  firestoreFn.FieldValue = { serverTimestamp: () => null };
  return {
    apps: [{}],
    initializeApp: jest.fn(),
    credential: { cert: jest.fn(), applicationDefault: jest.fn() },
    firestore: firestoreFn,
    storage: jest.fn(() => ({
      bucket: jest.fn(() => ({
        file: jest.fn(() => ({
          save: jest.fn().mockResolvedValue(undefined),
          makePublic: jest.fn().mockResolvedValue(undefined),
        })),
        name: 'test-bucket',
      })),
    })),
    app: jest.fn(),
  };
});

jest.mock('axios');

// Silence logger output during tests
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  http: jest.fn(),
}));

// Minimal service account for db.js
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'test-project',
  client_email: 'test@test.iam.gserviceaccount.com',
  private_key: 'fake-key',
});

const axios = require('axios');

const {
  _parseCategories,
  _parseCategoryPage,
  _toBigJpgUrl,
  _isYupooPhotoUrl,
  _extractCategoryId,
  _classifyFetchError,
  _FetchErrorType,
  _backoffDelay,
  _CIRCUIT_BREAKER_THRESHOLD,
} = require('../src/services/yupooService');

// ─── _toBigJpgUrl ─────────────────────────────────────────────────────────────

describe('_toBigJpgUrl', () => {
  it('converts small.jpg → big.jpg', () => {
    expect(_toBigJpgUrl('https://photo.yupoo.com/user/abc/small.jpg'))
      .toBe('https://photo.yupoo.com/user/abc/big.jpg');
  });

  it('converts medium.jpg → big.jpg', () => {
    expect(_toBigJpgUrl('https://photo.yupoo.com/user/abc/medium.jpg'))
      .toBe('https://photo.yupoo.com/user/abc/big.jpg');
  });

  it('converts large.jpg → big.jpg', () => {
    expect(_toBigJpgUrl('https://photo.yupoo.com/user/abc/large.jpg'))
      .toBe('https://photo.yupoo.com/user/abc/big.jpg');
  });

  it('converts thumb.jpg → big.jpg', () => {
    expect(_toBigJpgUrl('https://photo.yupoo.com/user/abc/thumb.jpg'))
      .toBe('https://photo.yupoo.com/user/abc/big.jpg');
  });

  it('leaves big.jpg unchanged', () => {
    const url = 'https://photo.yupoo.com/user/abc/big.jpg';
    expect(_toBigJpgUrl(url)).toBe(url);
  });

  it('does not modify URLs with no recognisable size token', () => {
    const url = 'https://photo.yupoo.com/user/abc/original.jpg';
    expect(_toBigJpgUrl(url)).toBe(url);
  });
});

// ─── _isYupooPhotoUrl ─────────────────────────────────────────────────────────

describe('_isYupooPhotoUrl', () => {
  it('accepts photo.yupoo.com URLs', () => {
    expect(_isYupooPhotoUrl('https://photo.yupoo.com/user/abc/big.jpg')).toBe(true);
  });

  it('rejects other hostnames', () => {
    expect(_isYupooPhotoUrl('https://evil.com/image.jpg')).toBe(false);
    expect(_isYupooPhotoUrl('https://yupoo.com/image.jpg')).toBe(false);
  });

  it('returns false for malformed URLs', () => {
    expect(_isYupooPhotoUrl('not-a-url')).toBe(false);
    expect(_isYupooPhotoUrl('')).toBe(false);
  });
});

// ─── _extractCategoryId ───────────────────────────────────────────────────────

describe('_extractCategoryId', () => {
  it('extracts numeric ID from a plain path', () => {
    expect(_extractCategoryId('/categories/5066922')).toBe('5066922');
  });

  it('strips query string before extracting', () => {
    expect(_extractCategoryId('/categories/729135?isSubCate=true')).toBe('729135');
  });

  it('strips trailing slashes', () => {
    expect(_extractCategoryId('/categories/5066922/')).toBe('5066922');
  });

  it('returns null for the root path', () => {
    expect(_extractCategoryId('/categories/')).toBeNull();
  });

  it('returns null for non-numeric segment', () => {
    expect(_extractCategoryId('/categories/abc')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(_extractCategoryId(null)).toBeNull();
  });
});

// ─── _parseCategories ─────────────────────────────────────────────────────────

describe('_parseCategories', () => {
  const sampleHtml = `
    <div class="categories__box-left">
      <div class="yupoo-collapse-item yupoo-collapse-item-all">
        <div class="yupoo-collapse-header">
          <a href="/categories/" title="All categories">All categories</a>
        </div>
        <div class="yupoo-collapse-content"></div>
      </div>
      <div class="yupoo-collapse-item">
        <div class="yupoo-collapse-header">
          <a href="/categories/5066922" title="Brasileiro Série A">Brasileiro Série A</a>
        </div>
        <div class="yupoo-collapse-content" data-l="23">
          <div class="yupoo-collapse-content-box">
            <a class="yupoo-collapse-content-item" href="/categories/729135?isSubCate=true" title="Atlético Mineiro">Atlético Mineiro</a>
            <a class="yupoo-collapse-content-item" href="/categories/729147?isSubCate=true" title="Sport Recife">Sport Recife</a>
          </div>
        </div>
      </div>
      <div class="yupoo-collapse-item">
        <div class="yupoo-collapse-header">
          <a href="/categories/5066921" title="Worldwide Other League">Worldwide Other League</a>
        </div>
        <div class="yupoo-collapse-content" data-l="0">
          <div class="yupoo-collapse-content-box"></div>
        </div>
      </div>
    </div>
  `;

  it('parses main categories (excluding All categories)', () => {
    const result = _parseCategories(sampleHtml);
    expect(result).toHaveLength(2);
  });

  it('extracts category id and name correctly', () => {
    const result = _parseCategories(sampleHtml);
    expect(result[0].id).toBe('5066922');
    expect(result[0].name).toBe('Brasileiro Série A');
    expect(result[0].path).toBe('/categories/5066922');
  });

  it('parses subcategoryCount from data-l attribute', () => {
    const result = _parseCategories(sampleHtml);
    expect(result[0].subcategoryCount).toBe(23);
    expect(result[1].subcategoryCount).toBe(0);
  });

  it('extracts subcategories as nested array', () => {
    const result = _parseCategories(sampleHtml);
    expect(result[0].subcategories).toHaveLength(2);
    expect(result[0].subcategories[0]).toMatchObject({
      id: '729135',
      name: 'Atlético Mineiro',
      path: '/categories/729135',
      isSubCate: true,
    });
  });

  it('returns empty array for empty HTML', () => {
    expect(_parseCategories('<html></html>')).toEqual([]);
  });
});

// ─── _parseCategoryPage ───────────────────────────────────────────────────────

describe('_parseCategoryPage', () => {
  const singleAlbumHtml = `
    <html><body>
    <div class="showalbumheader__main">
      <div class="showalbumheader__gallerydec">
        <h1><span data-name="Gremio 26-27 Home Jersey" class="showalbumheader__gallerytitle">Gremio 26-27 Home Jersey</span></h1>
      </div>
    </div>
    <main class="showalbum__imagecardwrap">
      <div class="showalbum__parent">
        <div class="showalbum__children image__main">
          <div class="image__imagewrap">
            <img class="image__img" data-src="https://photo.yupoo.com/micom0078/bf32fde523/big.jpg">
          </div>
        </div>
        <div class="showalbum__children image__main">
          <div class="image__imagewrap">
            <img class="image__img" data-src="https://photo.yupoo.com/micom0078/b81179caea/big.jpg">
          </div>
        </div>
      </div>
    </main>
    </body></html>
  `;

  it('parses a single album detail page', () => {
    const result = _parseCategoryPage(singleAlbumHtml);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Gremio 26-27 Home Jersey');
    expect(result[0].images).toHaveLength(2);
    expect(result[0].images[0]).toBe('https://photo.yupoo.com/micom0078/bf32fde523/big.jpg');
  });

  it('returns empty array when no .showalbumheader__main found', () => {
    expect(_parseCategoryPage('<html><body></body></html>')).toEqual([]);
  });

  it('converts small/medium src to big.jpg', () => {
    const html = `
      <div class="showalbumheader__main">
        <h1><span data-name="Test Product">Test Product</span></h1>
      </div>
      <main class="showalbum__imagecardwrap">
        <div class="showalbum__children image__main">
          <img class="image__img" data-src="https://photo.yupoo.com/user/abc/medium.jpg">
        </div>
      </main>
    `;
    const result = _parseCategoryPage(html);
    expect(result).toHaveLength(1);
    expect(result[0].images[0]).toBe('https://photo.yupoo.com/user/abc/big.jpg');
  });

  it('skips non-yupoo image URLs', () => {
    const html = `
      <div class="showalbumheader__main">
        <h1><span data-name="Test Product">Test Product</span></h1>
      </div>
      <main class="showalbum__imagecardwrap">
        <div class="showalbum__children image__main">
          <img class="image__img" data-src="https://evil.com/image.jpg">
        </div>
      </main>
    `;
    const result = _parseCategoryPage(html);
    // product is skipped entirely since no valid images
    expect(result).toHaveLength(0);
  });

  it('limits images to MAX_IMAGES_PER_PRODUCT (10)', () => {
    const images = Array.from({ length: 15 }, (_, i) =>
      `<img class="image__img" data-src="https://photo.yupoo.com/user/img${i}/big.jpg">`
    ).join('');
    const html = `
      <div class="showalbumheader__main">
        <h1><span data-name="Many Images">Many Images</span></h1>
      </div>
      <main class="showalbum__imagecardwrap">
        <div class="showalbum__children image__main">${images}</div>
      </main>
    `;
    const result = _parseCategoryPage(html);
    expect(result[0].images.length).toBeLessThanOrEqual(10);
  });
});

// ─── _classifyFetchError ──────────────────────────────────────────────────────

describe('_classifyFetchError', () => {
  it('classifies ECONNABORTED as timeout (retryable)', () => {
    const err = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    const c = _classifyFetchError(err);
    expect(c.type).toBe(_FetchErrorType.TIMEOUT);
    expect(c.retryable).toBe(true);
    expect(c.httpStatus).toBeNull();
  });

  it('classifies ETIMEDOUT as timeout (retryable)', () => {
    const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    const c = _classifyFetchError(err);
    expect(c.type).toBe(_FetchErrorType.TIMEOUT);
    expect(c.retryable).toBe(true);
  });

  it('classifies ECONNREFUSED as network error (retryable)', () => {
    const err = Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const c = _classifyFetchError(err);
    expect(c.type).toBe(_FetchErrorType.NETWORK);
    expect(c.retryable).toBe(true);
  });

  it('classifies HTTP 429 as rate_limited (retryable)', () => {
    const err = Object.assign(new Error('Too Many Requests'), {
      response: { status: 429 },
    });
    const c = _classifyFetchError(err);
    expect(c.type).toBe(_FetchErrorType.RATE_LIMITED);
    expect(c.retryable).toBe(true);
    expect(c.httpStatus).toBe(429);
  });

  it('classifies HTTP 500 as server_error (retryable)', () => {
    const err = Object.assign(new Error('Internal Server Error'), {
      response: { status: 500 },
    });
    const c = _classifyFetchError(err);
    expect(c.type).toBe(_FetchErrorType.SERVER_ERROR);
    expect(c.retryable).toBe(true);
    expect(c.httpStatus).toBe(500);
  });

  it('classifies HTTP 404 as client_error (NOT retryable)', () => {
    const err = Object.assign(new Error('Not Found'), {
      response: { status: 404 },
    });
    const c = _classifyFetchError(err);
    expect(c.type).toBe(_FetchErrorType.CLIENT_ERROR);
    expect(c.retryable).toBe(false);
    expect(c.httpStatus).toBe(404);
  });

  it('classifies HTTP 403 as client_error (NOT retryable)', () => {
    const err = Object.assign(new Error('Forbidden'), {
      response: { status: 403 },
    });
    const c = _classifyFetchError(err);
    expect(c.type).toBe(_FetchErrorType.CLIENT_ERROR);
    expect(c.retryable).toBe(false);
  });

  it('classifies unknown errors as unknown (NOT retryable)', () => {
    const err = new Error('Something weird');
    const c = _classifyFetchError(err);
    expect(c.type).toBe(_FetchErrorType.UNKNOWN);
    expect(c.retryable).toBe(false);
  });
});

// ─── _backoffDelay ────────────────────────────────────────────────────────────

describe('_backoffDelay', () => {
  it('returns a non-negative number', () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const delay = _backoffDelay(attempt);
      expect(delay).toBeGreaterThanOrEqual(0);
    }
  });

  it('does not exceed RETRY_MAX_DELAY_MS (5000ms)', () => {
    // High attempt numbers should still be capped
    for (let attempt = 1; attempt <= 20; attempt++) {
      const delay = _backoffDelay(attempt);
      expect(delay).toBeLessThanOrEqual(5_000);
    }
  });

  it('generally increases with attempt number (statistical)', () => {
    // Average of many samples for attempt=3 should be higher than attempt=1
    const avg = (attempt, samples = 200) => {
      let sum = 0;
      for (let i = 0; i < samples; i++) sum += _backoffDelay(attempt);
      return sum / samples;
    };
    expect(avg(3)).toBeGreaterThan(avg(1));
  });
});

// ─── Circuit Breaker Threshold ────────────────────────────────────────────────

describe('Circuit breaker constants', () => {
  it('CIRCUIT_BREAKER_THRESHOLD is a positive integer', () => {
    expect(typeof _CIRCUIT_BREAKER_THRESHOLD).toBe('number');
    expect(_CIRCUIT_BREAKER_THRESHOLD).toBeGreaterThan(0);
    expect(Number.isInteger(_CIRCUIT_BREAKER_THRESHOLD)).toBe(true);
  });
});

// ─── FetchErrorType enum ──────────────────────────────────────────────────────

describe('FetchErrorType values', () => {
  it('has expected string values', () => {
    expect(_FetchErrorType.TIMEOUT).toBe('timeout');
    expect(_FetchErrorType.RATE_LIMITED).toBe('rate_limited');
    expect(_FetchErrorType.SERVER_ERROR).toBe('server_error');
    expect(_FetchErrorType.CLIENT_ERROR).toBe('client_error');
    expect(_FetchErrorType.NETWORK).toBe('network');
    expect(_FetchErrorType.INVALID_RESPONSE).toBe('invalid_response');
    expect(_FetchErrorType.UNKNOWN).toBe('unknown');
  });
});
