/**
 * Unit tests for supplierService crawl helpers:
 *   - _toBigJpgUrl
 *   - _isSupplierPhotoUrl
 *   - _parseAlbumDetail
 *   - _parseAlbumListing
 *   - _extractAlbumTitle
 */

'use strict';

// ─── Mock heavy dependencies so the test can run without Firebase ─────────────

jest.mock('../src/services/db', () => ({
  admin: {
    firestore: {
      FieldValue: { serverTimestamp: () => ({ _type: 'serverTimestamp' }) },
    },
  },
  getDb: jest.fn(() => ({
    collection: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
      doc: jest.fn(() => ({
        set: jest.fn().mockResolvedValue(undefined),
        get: jest.fn().mockResolvedValue({ id: 'mockId', exists: true, data: () => ({}) }),
        id: 'mockId',
      })),
    })),
  })),
}));

jest.mock('../src/services/upload', () => ({
  downloadAndUploadImages: jest.fn().mockResolvedValue(['https://storage.googleapis.com/bucket/products/abc.jpg']),
}));

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../src/models/Product', () => ({
  collection: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
    doc: jest.fn(() => ({
      set: jest.fn().mockResolvedValue(undefined),
      id: 'mockProductId',
    })),
  })),
  serialize: jest.fn((snap) => snap && snap.exists ? { id: snap.id, ...snap.data() } : null),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

const {
  _toBigJpgUrl,
  _isSupplierPhotoUrl,
  _parseAlbumDetail,
  _parseAlbumListing,
  _extractAlbumTitle,
} = require('../src/services/supplierService');

const cheerio = require('cheerio');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('_toBigJpgUrl', () => {
  test('replaces /small.jpg with /big.jpg', () => {
    expect(_toBigJpgUrl('https://photo.yupoo.com/user/abc/small.jpg'))
      .toBe('https://photo.yupoo.com/user/abc/big.jpg');
  });

  test('replaces /medium.jpg with /big.jpg', () => {
    expect(_toBigJpgUrl('https://photo.yupoo.com/user/abc/medium.jpg'))
      .toBe('https://photo.yupoo.com/user/abc/big.jpg');
  });

  test('replaces /large.jpg with /big.jpg', () => {
    expect(_toBigJpgUrl('https://photo.yupoo.com/user/abc/large.jpg'))
      .toBe('https://photo.yupoo.com/user/abc/big.jpg');
  });

  test('replaces /thumb.jpg with /big.jpg', () => {
    expect(_toBigJpgUrl('https://photo.yupoo.com/user/abc/thumb.jpg'))
      .toBe('https://photo.yupoo.com/user/abc/big.jpg');
  });

  test('leaves /big.jpg unchanged', () => {
    expect(_toBigJpgUrl('https://photo.yupoo.com/user/abc/big.jpg'))
      .toBe('https://photo.yupoo.com/user/abc/big.jpg');
  });

  test('is case-insensitive for suffix', () => {
    expect(_toBigJpgUrl('https://photo.yupoo.com/user/abc/SMALL.jpg'))
      .toBe('https://photo.yupoo.com/user/abc/big.jpg');
  });

  test('does not alter non-supplier URLs (regex applies regardless)', () => {
    const url = 'https://example.com/some/path/small.jpg';
    expect(_toBigJpgUrl(url)).toBe('https://example.com/some/path/big.jpg');
  });
});

describe('_isSupplierPhotoUrl', () => {
  test('returns true for valid supplier photo URL', () => {
    expect(_isSupplierPhotoUrl('https://photo.yupoo.com/micom0078/bf32fde523/big.jpg'))
      .toBe(true);
  });

  test('returns false for non-supplier URL', () => {
    expect(_isSupplierPhotoUrl('https://example.com/image.jpg')).toBe(false);
  });

  test('returns false for malformed URL', () => {
    expect(_isSupplierPhotoUrl('not-a-url')).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(_isSupplierPhotoUrl('')).toBe(false);
  });

  test('returns false for non-photo supplier subdomain', () => {
    expect(_isSupplierPhotoUrl('https://micom0078.x.yupoo.com/categories/')).toBe(false);
  });
});

describe('_parseAlbumDetail', () => {
  const albumDetailHtml = `
    <html><body>
      <div class="showalbumheader__main">
        <div class="showalbumheader__gallerydec">
          <h1><span data-name="Gremio 26-27 Home Jersey S-4XL" class="showalbumheader__gallerytitle">Gremio 26-27 Home Jersey S-4XL</span></h1>
        </div>
      </div>
      <main class="showalbum__imagecardwrap">
        <div class="showalbum__children image__main">
          <div class="image__imagewrap">
            <img data-src="https://photo.yupoo.com/micom0078/bf32fde523/big.jpg" class="image__img" src="https://photo.yupoo.com/micom0078/bf32fde523/small.jpg">
          </div>
        </div>
        <div class="showalbum__children image__main">
          <div class="image__imagewrap">
            <img data-src="https://photo.yupoo.com/micom0078/b81179caea/big.jpg" class="image__img" src="https://photo.yupoo.com/micom0078/b81179caea/small.jpg">
          </div>
        </div>
        <div class="showalbum__children image__main">
          <div class="image__imagewrap">
            <img data-src="https://photo.yupoo.com/micom0078/d0ddccaf7a/big.jpg" class="image__img" src="https://photo.yupoo.com/micom0078/d0ddccaf7a/small.jpg">
          </div>
        </div>
      </main>
    </body></html>
  `;

  test('extracts product from album detail page', () => {
    const product = _parseAlbumDetail(albumDetailHtml);
    expect(product).not.toBeNull();
    expect(product.name).toBe('Gremio 26-27 Home Jersey S-4XL');
    expect(product.images).toHaveLength(3);
    expect(product.images[0]).toBe('https://photo.yupoo.com/micom0078/bf32fde523/big.jpg');
  });

  test('converts small.jpg data-src to big.jpg', () => {
    const html = `
      <html><body>
        <div class="showalbumheader__main">
          <h1><span data-name="Test Product">Test Product</span></h1>
        </div>
        <main class="showalbum__imagecardwrap">
          <div class="showalbum__children image__main">
            <div class="image__imagewrap">
              <img data-src="https://photo.yupoo.com/micom0078/abc123/small.jpg" class="image__img">
            </div>
          </div>
        </main>
      </body></html>
    `;
    const product = _parseAlbumDetail(html);
    expect(product.images[0]).toBe('https://photo.yupoo.com/micom0078/abc123/big.jpg');
  });

  test('drops non-supplier image URLs (returns batch with empty images)', () => {
    const html = `
      <html><body>
        <div class="showalbumheader__main">
          <h1><span data-name="Test Product">Test Product</span></h1>
        </div>
        <main class="showalbum__imagecardwrap">
          <div class="showalbum__children image__main">
            <div class="image__imagewrap">
              <img data-src="https://evil.com/hacked.jpg" class="image__img">
            </div>
          </div>
        </main>
      </body></html>
    `;
    const product = _parseAlbumDetail(html);
    expect(product).not.toBeNull();
    expect(product.images).toEqual([]);
  });

  test('limits images to 10 per product', () => {
    const images = Array.from({ length: 15 }, (_, i) =>
      `<div class="showalbum__children image__main"><div class="image__imagewrap"><img data-src="https://photo.yupoo.com/u/${i}/big.jpg" class="image__img"></div></div>`
    ).join('');
    const html = `
      <html><body>
        <div class="showalbumheader__main">
          <h1><span data-name="Lots of Images">Lots of Images</span></h1>
        </div>
        <main class="showalbum__imagecardwrap">${images}</main>
      </body></html>
    `;
    const product = _parseAlbumDetail(html);
    expect(product.images).toHaveLength(10);
  });

  test('returns null when no .showalbumheader__main found', () => {
    const html = '<html><body><p>Nothing here</p></body></html>';
    expect(_parseAlbumDetail(html)).toBeNull();
  });

  test('falls back to h1 text when data-name absent', () => {
    const html = `
      <html><body>
        <div class="showalbumheader__main">
          <h1>Fallback Title</h1>
        </div>
        <main class="showalbum__imagecardwrap">
          <div class="showalbum__children image__main">
            <div class="image__imagewrap">
              <img data-src="https://photo.yupoo.com/micom0078/xyz/big.jpg" class="image__img">
            </div>
          </div>
        </main>
      </body></html>
    `;
    const product = _parseAlbumDetail(html);
    expect(product.name).toBe('Fallback Title');
  });
});

describe('_parseAlbumListing', () => {
  test('returns one entry per a.album__main card with title + albumPath', () => {
    const html = `
      <html><body>
        <a class="album__main" title="Jersey A" href="/albums/100?uid=1"></a>
        <a class="album__main" title="Jersey B" href="/albums/200?uid=1"></a>
      </body></html>
    `;
    const albums = _parseAlbumListing(html);
    expect(albums).toEqual([
      { name: 'Jersey A', albumPath: '/albums/100?uid=1' },
      { name: 'Jersey B', albumPath: '/albums/200?uid=1' },
    ]);
  });

  test('rejects album cards whose href does not begin with /albums/', () => {
    const html = `
      <a class="album__main" title="Bad" href="/categories/1"></a>
      <a class="album__main" title="Good" href="/albums/1"></a>
    `;
    const albums = _parseAlbumListing(html);
    expect(albums).toHaveLength(1);
    expect(albums[0].name).toBe('Good');
  });

  test('returns [] when no album cards present', () => {
    expect(_parseAlbumListing('<html><body></body></html>')).toEqual([]);
  });
});

describe('_extractAlbumTitle', () => {
  test('prefers data-name over h1 text', () => {
    const html = `<div class="showalbumheader__main"><h1><span data-name="DataName">H1 Text</span></h1></div>`;
    const $ = cheerio.load(html);
    const $header = $('.showalbumheader__main');
    expect(_extractAlbumTitle($, $header)).toBe('DataName');
  });

  test('falls back to h1 text when no data-name', () => {
    const html = `<div class="showalbumheader__main"><h1>Album H1 Title</h1></div>`;
    const $ = cheerio.load(html);
    const $header = $('.showalbumheader__main');
    expect(_extractAlbumTitle($, $header)).toBe('Album H1 Title');
  });

  test('returns empty string when neither data-name nor h1 present', () => {
    const html = `<div class="showalbumheader__main"><p>no title</p></div>`;
    const $ = cheerio.load(html);
    const $header = $('.showalbumheader__main');
    expect(_extractAlbumTitle($, $header)).toBe('');
  });

  test('trims whitespace from extracted title', () => {
    const html = `<div class="showalbumheader__main"><h1>  Trimmed Title  </h1></div>`;
    const $ = cheerio.load(html);
    const $header = $('.showalbumheader__main');
    expect(_extractAlbumTitle($, $header)).toBe('Trimmed Title');
  });
});
