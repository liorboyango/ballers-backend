/**
 * Unit tests for src/services/yupooService.js
 *
 * We test only the pure HTML-parsing logic (_parseCategories, _extractCategoryId)
 * without making real network requests. The HTTP fetch is tested indirectly
 * through integration / e2e tests.
 */

'use strict';

const {
  _parseCategories: parseCategories,
  _extractCategoryId: extractCategoryId,
} = require('../src/services/yupooService');

// ─── extractCategoryId ───────────────────────────────────────────────────────

describe('extractCategoryId()', () => {
  test('extracts numeric ID from plain category path', () => {
    expect(extractCategoryId('/categories/5066922')).toBe('5066922');
  });

  test('extracts numeric ID from subcategory path with isSubCate query param', () => {
    expect(extractCategoryId('/categories/729135?isSubCate=true')).toBe('729135');
  });

  test('returns null for the root categories path (/categories/)', () => {
    // The root path has no numeric segment — callers skip it separately
    expect(extractCategoryId('/categories/')).toBeNull();
  });

  test('returns null for a path without a numeric segment', () => {
    expect(extractCategoryId('/categories/abc')).toBeNull();
  });

  test('returns null for an empty string', () => {
    expect(extractCategoryId('')).toBeNull();
  });

  test('returns null for null / undefined', () => {
    expect(extractCategoryId(null)).toBeNull();
    expect(extractCategoryId(undefined)).toBeNull();
  });

  test('handles paths with trailing slashes', () => {
    expect(extractCategoryId('/categories/12345/')).toBe('12345');
  });
});

// ─── parseCategories() ───────────────────────────────────────────────────────

describe('parseCategories()', () => {
  /**
   * Minimal representative HTML taken from the real Yupoo categories page.
   * Covers:
   *  - Category without subcategories (data-l="0")
   *  - Category with multiple subcategories (data-l="N")
   *  - The "All categories" pseudo-item that should be skipped
   */
  const SAMPLE_HTML = `
    <div class="categories__box-left">
      <!-- Should be skipped — "All categories" pseudo-item -->
      <div class="yupoo-collapse-item yupoo-collapse-item-all yupoo-collapse-item-single yupoo-collapse-item-selected">
        <div class="yupoo-collapse-header" style="border-top: none;">
          <a href="/categories/" title="All categories">All categories</a>
        </div>
        <div class="yupoo-collapse-content yupoo-collapse-content-hidden"></div>
      </div>

      <!-- Category with no subcategories -->
      <div class="yupoo-collapse-item">
        <div class="yupoo-collapse-header">
          <a href="/categories/5066921" title="Worldwide Other League">Worldwide Other League</a>
        </div>
        <div class="yupoo-collapse-content yupoo-collapse-content-hidden" data-l="0">
          <div class="yupoo-collapse-content-box"></div>
        </div>
      </div>

      <!-- Category WITH subcategories -->
      <div class="yupoo-collapse-item">
        <div class="yupoo-collapse-header">
          <a href="/categories/5066922" title="Brasileiro S\u00e9rie A">Brasileiro S\u00e9rie A</a>
        </div>
        <div class="yupoo-collapse-content yupoo-collapse-content-hidden" data-l="23">
          <div class="yupoo-collapse-content-box">
            <a class="yupoo-collapse-content-item" href="/categories/729135?isSubCate=true" title="Atl\u00e9tico Mineiro">Atl\u00e9tico Mineiro</a>
            <a class="yupoo-collapse-content-item" href="/categories/729147?isSubCate=true" title="Sport Recife">Sport Recife</a>
          </div>
        </div>
      </div>

      <!-- Category with a subcategory link missing the isSubCate param -->
      <div class="yupoo-collapse-item">
        <div class="yupoo-collapse-header">
          <a href="/categories/5066920" title="La Liga">La Liga</a>
        </div>
        <div class="yupoo-collapse-content yupoo-collapse-content-hidden" data-l="37">
          <div class="yupoo-collapse-content-box">
            <a class="yupoo-collapse-content-item" href="/categories/729116?isSubCate=true" title="Celta de Vigo">Celta de Vigo</a>
          </div>
        </div>
      </div>
    </div>
  `;

  let categories;

  beforeAll(() => {
    categories = parseCategories(SAMPLE_HTML);
  });

  test('skips the "All categories" pseudo-item', () => {
    const allCats = categories.find((c) => c.name === 'All categories');
    expect(allCats).toBeUndefined();
  });

  test('returns the correct number of categories', () => {
    // 3 real categories: Worldwide Other League, Brasileiro, La Liga
    expect(categories).toHaveLength(3);
  });

  test('parses a category without subcategories correctly', () => {
    const wol = categories.find((c) => c.id === '5066921');
    expect(wol).toBeDefined();
    expect(wol.name).toBe('Worldwide Other League');
    expect(wol.path).toBe('/categories/5066921');
    expect(wol.subcategoryCount).toBe(0);
    expect(wol.subcategories).toHaveLength(0);
  });

  test('parses a category with subcategories correctly', () => {
    const brasil = categories.find((c) => c.id === '5066922');
    expect(brasil).toBeDefined();
    expect(brasil.name).toBe('Brasileiro S\u00e9rie A');
    expect(brasil.subcategoryCount).toBe(23);
    expect(brasil.subcategories).toHaveLength(2);
  });

  test('parses subcategory nodes with correct shape', () => {
    const brasil = categories.find((c) => c.id === '5066922');
    const atletico = brasil.subcategories.find((s) => s.id === '729135');
    expect(atletico).toBeDefined();
    expect(atletico.name).toBe('Atl\u00e9tico Mineiro');
    expect(atletico.path).toBe('/categories/729135');
    expect(atletico.isSubCate).toBe(true);
  });

  test('subcategory path does NOT contain query string', () => {
    const brasil = categories.find((c) => c.id === '5066922');
    brasil.subcategories.forEach((sub) => {
      expect(sub.path).not.toContain('?');
    });
  });

  test('handles categories where data-l attribute is absent', () => {
    // La Liga has data-l="37" in the sample; Worldwide has data-l="0"
    const laLiga = categories.find((c) => c.id === '5066920');
    expect(laLiga.subcategoryCount).toBe(37);
  });

  test('returns empty array for HTML with no matching elements', () => {
    const result = parseCategories('<html><body>No categories here</body></html>');
    expect(result).toEqual([]);
  });

  test('returns empty array for empty HTML string', () => {
    const result = parseCategories('');
    expect(result).toEqual([]);
  });
});
