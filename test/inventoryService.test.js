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
  beforeEach(() => {
    jest.spyOn(persist, 'inventory').mockImplementation(() => {});
    datasets.inventory = [
      buildUnit({ id: 'a', vin: 'VIN-A', name: 'Luxury Coach', featured: true, price: 150000, condition: 'new' }),
      buildUnit({ id: 'b', vin: 'VIN-B', name: 'Used Camper', condition: 'used', price: 80000, tenantId: 'lexington' }),
      buildUnit({ id: 'c', vin: 'VIN-C', name: 'Budget Coach', condition: 'demo', price: 90000, category: 'Trailer' })
    ];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('filters by tenant and condition', () => {
    const result = inventoryService.list({ condition: 'new' }, 'main');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('a');
  });

  it('applies price range and search', () => {
    const result = inventoryService.list({ minPrice: 70000, maxPrice: 120000, search: 'coach' }, 'main');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('c');
  });

  it('supports pagination metadata', () => {
    const result = inventoryService.list({ limit: 1, offset: 0 }, 'main');
    expect(result.meta.total).toBe(2);
    expect(result.items).toHaveLength(1);
  });
});

describe('inventoryService VIN uniqueness', () => {
  beforeEach(() => {
    jest.spyOn(persist, 'inventory').mockImplementation(() => {});
    datasets.inventory = [buildUnit({ id: 'seed', vin: 'VIN-123', tenantId: 'main' })];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects creating duplicate VIN in same tenant', () => {
    const result = inventoryService.create({ stockNumber: 'X', vin: 'VIN-123', name: 'Dup', condition: 'new', price: 1 }, 'main');
    expect(result.error).toMatch(/VIN must be unique/i);
  });

  it('allows same VIN across tenants', () => {
    const result = inventoryService.create({ stockNumber: 'Y', vin: 'VIN-123', name: 'Other', condition: 'new', price: 1 }, 'lexington');
    expect(result.unit).toBeDefined();
    expect(result.unit.tenantId).toBe('lexington');
  });
});
