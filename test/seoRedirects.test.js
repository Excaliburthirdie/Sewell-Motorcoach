const assert = require('node:assert/strict');
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const { datasets, persist } = require('../src/services/state');
const seoService = require('../src/services/seoService');
const redirectService = require('../src/services/redirectService');

function seedInventory() {
  datasets.inventory = [
    {
      id: 'inv-1',
      stockNumber: 'STK-1',
      vin: 'VIN-1',
      name: 'Coach',
      condition: 'new',
      price: 100,
      tenantId: 'main'
    },
    {
      id: 'inv-2',
      stockNumber: 'STK-2',
      vin: 'VIN-2',
      name: 'Coach 2',
      condition: 'new',
      price: 150,
      metaTitle: 'Custom title',
      metaDescription: 'Meta',
      tenantId: 'main'
    }
  ];
}

function seedPages() {
  datasets.contentPages = [
    { id: 'p1', title: 'About', slug: 'about', tenantId: 'main' },
    { id: 'p2', title: 'About', slug: 'about-2', tenantId: 'main' }
  ];
}

describe('seoService.seoHealth', () => {
  let persistMocks;
  beforeEach(() => {
    persistMocks = [
      mock.method(persist, 'seoProfiles', () => {}),
      mock.method(persist, 'inventory', () => {}),
      mock.method(persist, 'contentPages', () => {})
    ];
    seedInventory();
    seedPages();
    datasets.seoProfiles = [
      { id: 's1', resourceType: 'inventory', resourceId: 'inv-2', metaTitle: 'Profile Title', tenantId: 'main' }
    ];
  });

  afterEach(() => {
    persistMocks.forEach(m => m.mock.restore());
  });

  it('returns warnings for missing metadata and duplicates', () => {
    const result = seoService.seoHealth('main');
    assert.equal(result.metrics.unitsMissingSeoTitle.value, 1);
    assert.equal(result.metrics.unitsMissingMetaDescription.value, 1);
    assert.equal(result.metrics.pagesWithDuplicateTitles.value, 1);
    assert.equal(result.metrics.schemaValidationErrors.value, 0);
  });

  it('detects schema markup errors', () => {
    datasets.seoProfiles.push({
      id: 's2',
      resourceType: 'content',
      resourceId: 'p1',
      schemaMarkup: '{bad json',
      tenantId: 'main'
    });
    const result = seoService.seoHealth('main');
    assert.equal(result.metrics.schemaValidationErrors.value, 1);
  });
});

describe('seoService canonical resolution', () => {
  beforeEach(() => {
    mock.method(persist, 'seoProfiles', () => {});
    datasets.seoProfiles = [];
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('prefers profile canonical and normalizes relative paths', () => {
    datasets.seoProfiles.push({
      id: 'c1',
      resourceType: 'inventory',
      resourceId: 'inv-1',
      canonicalUrl: 'inventory/custom',
      tenantId: 'main'
    });
    const canonical = seoService.resolveCanonical('inventory', 'inv-1', 'main', () => ({ id: 'inv-1', slug: 'inv-1' }));
    assert.equal(canonical, '/inventory/custom');
  });

  it('falls back to default canonical when profile missing', () => {
    const canonical = seoService.resolveCanonical('content', 'page-1', 'main', () => ({ id: 'page-1', slug: 'page-1' }));
    assert.equal(canonical, '/pages/page-1');
  });
});

describe('redirectService', () => {
  let persistMock;
  beforeEach(() => {
    persistMock = mock.method(persist, 'redirects', () => {});
    datasets.redirects = [];
  });

  afterEach(() => {
    persistMock.mock.restore();
  });

  it('creates and lists redirects per tenant', () => {
    const created = redirectService.create({ sourcePath: '/old', targetPath: '/new', statusCode: 302 }, 'main');
    assert.ok(created.redirect.id);
    assert.equal(created.redirect.statusCode, 302);
    const list = redirectService.list('main');
    assert.equal(list.length, 1);
    assert.equal(list[0].sourcePath, '/old');
  });

  it('prevents duplicate sourcePath within tenant', () => {
    redirectService.create({ sourcePath: '/old', targetPath: '/new' }, 'main');
    const result = redirectService.create({ sourcePath: '/old', targetPath: '/newer' }, 'main');
    assert.match(result.error, /already exists/i);
  });

  it('treats sourcePath comparison as case-insensitive and trims', () => {
    redirectService.create({ sourcePath: ' /Old ', targetPath: '/new' }, 'main');
    const result = redirectService.create({ sourcePath: '/old', targetPath: '/newer' }, 'main');
    assert.match(result.error, /already exists/i);
  });

  it('removes redirect by tenant', () => {
    const created = redirectService.create({ sourcePath: '/old', targetPath: '/new' }, 'main');
    const removal = redirectService.remove(created.redirect.id, 'main');
    assert.ok(removal.success);
    assert.equal(redirectService.list('main').length, 0);
  });
});
