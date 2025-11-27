const assert = require('node:assert/strict');
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const inventoryService = require('../src/services/inventoryService');
const { datasets, persist } = require('../src/services/state');

function buildUnit(overrides = {}) {
  return {
    id: `unit-${Math.random()}`,
    stockNumber: 'STK-1',
    vin: 'VIN-BASE',
    name: 'Coach',
    industry: 'RV',
    category: 'Motorhome',
    subcategory: 'Class A',
    condition: 'new',
    price: 100000,
    transferStatus: 'none',
    createdAt: '2023-01-01T00:00:00.000Z',
    tenantId: 'main',
    ...overrides
  };
}

describe('inventoryService list filters', () => {
  let persistMock;

  beforeEach(() => {
    persistMock = mock.method(persist, 'inventory', () => {});
    datasets.inventory = [
      buildUnit({ id: 'a', vin: 'VIN-A', name: 'Luxury Coach', featured: true, price: 150000, condition: 'new' }),
      buildUnit({ id: 'b', vin: 'VIN-B', name: 'Used Camper', condition: 'used', price: 80000, tenantId: 'lexington' }),
      buildUnit({ id: 'c', vin: 'VIN-C', name: 'Budget Coach', condition: 'demo', price: 90000, category: 'Trailer' })
    ];
  });

  afterEach(() => {
    persistMock?.mock.restore();
  });

  it('filters by tenant and condition', () => {
    const result = inventoryService.list({ condition: 'new' }, 'main');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, 'a');
  });

  it('applies price range and search', () => {
    const result = inventoryService.list({ minPrice: 70000, maxPrice: 120000, search: 'coach' }, 'main');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].id, 'c');
  });

  it('supports pagination metadata', () => {
    const result = inventoryService.list({ limit: 1, offset: 0 }, 'main');
    assert.equal(result.meta.total, 2);
    assert.equal(result.items.length, 1);
  });
});

describe('inventoryService VIN uniqueness', () => {
  let persistMock;

  beforeEach(() => {
    persistMock = mock.method(persist, 'inventory', () => {});
    datasets.inventory = [buildUnit({ id: 'seed', vin: 'VIN-123', tenantId: 'main' })];
  });

  afterEach(() => {
    persistMock?.mock.restore();
  });

  it('rejects creating duplicate VIN in same tenant', () => {
    const result = inventoryService.create({ stockNumber: 'X', vin: 'VIN-123', name: 'Dup', condition: 'new', price: 1 }, 'main');
    assert.match(result.error, /VIN must be unique/i);
  });

  it('allows same VIN across tenants', () => {
    const result = inventoryService.create({ stockNumber: 'Y', vin: 'VIN-123', name: 'Other', condition: 'new', price: 1 }, 'lexington');
    assert.ok(result.unit);
    assert.equal(result.unit.tenantId, 'lexington');
  });
});

describe('inventoryService importCsv', () => {
  let persistMock;

  beforeEach(() => {
    persistMock = mock.method(persist, 'inventory', () => {});
    datasets.inventory = [];
  });

  afterEach(() => {
    persistMock?.mock.restore();
  });

  it('parses extended fields and media lists', () => {
    const csv = [
      'stockNumber,vin,name,condition,price,fees,rebates,images,floorplans,virtualTours,videoLinks,holdUntil,year,length,weight,chassis,description,metaTitle,metaDescription',
      'STK-9,VIN-999,Flagship,new,200000,500,1000,https://ex.com/a.jpg|https://ex.com/b.jpg,https://ex.com/fp.pdf,https://ex.com/vr,https://ex.com/vid,2024-01-01,2024,40,15000,Spartan,Premium coach,Great title,Meta description'
    ].join('\n');

    const result = inventoryService.importCsv(csv, 'main');

    assert.equal(result.errors.length, 0);
    assert.equal(result.created.length, 1);
    const unit = result.created[0];
    assert.deepEqual(unit.images, [
      'https://ex.com/a.jpg',
      'https://ex.com/b.jpg'
    ]);
    assert.deepEqual(unit.floorplans, ['https://ex.com/fp.pdf']);
    assert.deepEqual(unit.virtualTours, ['https://ex.com/vr']);
    assert.deepEqual(unit.videoLinks, ['https://ex.com/vid']);
    assert.equal(unit.year, 2024);
    assert.equal(unit.length, 40);
    assert.equal(unit.weight, 15000);
    assert.equal(unit.chassis, 'Spartan');
    assert.equal(unit.description, 'Premium coach');
    assert.equal(unit.metaTitle, 'Great title');
    assert.equal(unit.metaDescription, 'Meta description');
    assert.ok(unit.holdUntil.includes('2024-01-01'));
  });
});
