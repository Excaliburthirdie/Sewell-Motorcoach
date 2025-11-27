const assert = require('node:assert/strict');
const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const { computeInventoryBadges } = require('../src/services/inventoryBadges');
const inventoryService = require('../src/services/inventoryService');
const inventorySchemaService = require('../src/services/inventorySchemaService');
const { datasets, persist } = require('../src/services/state');

const baseUnit = overrides => ({
  id: 'unit-1',
  stockNumber: 'STK-1',
  vin: 'VIN-11111111111',
  name: 'Adventure Coach',
  condition: 'new',
  price: 100000,
  tenantId: 'main',
  createdAt: '2023-01-01T00:00:00.000Z',
  ...overrides
});

describe('inventory badges engine', () => {
  let originalSettings;

  beforeEach(() => {
    originalSettings = [...datasets.settings];
    datasets.settings = [
      {
        tenantId: 'main',
        badgeConfig: [{ matchField: 'fuelType', matchValue: 'diesel', label: 'Diesel Power' }]
      }
    ];
  });

  afterEach(() => {
    datasets.settings = originalSettings;
  });

  it('generates badges from heuristics and tenant config', () => {
    const unit = baseUnit({ length: 28, solar: ['roof'], batteries: ['Lithium Pro'], fuelType: 'diesel' });
    const badges = computeInventoryBadges(unit, 'main');
    assert.ok(badges.includes('Off-Grid Ready'));
    assert.ok(badges.includes('National Park Friendly'));
    assert.ok(badges.includes('Diesel Power'));
  });
});

describe('inventory storytelling surfaces', () => {
  let persistMock;

  beforeEach(() => {
    persistMock = mock.method(persist, 'inventory', () => {});
    datasets.inventory = [baseUnit({ id: 'unit-story', vin: 'VIN-22222222222' })];
  });

  afterEach(() => {
    persistMock?.mock.restore();
  });

  it('updates sales story and spotlights with tenant scoping', () => {
    const storyResult = inventoryService.updateStory('unit-story', 'Salesman take', 'main');
    assert.equal(storyResult.unit.salesStory, 'Salesman take');

    const spotlightResult = inventoryService.updateSpotlights(
      'unit-story',
      [
        { title: 'New Tires', description: 'Michelin upgrade', valueTag: '$4,000', priority: 1 },
        { id: 'fixed-id', title: 'Solar Ready', description: 'Panels installed', priority: 2 }
      ],
      'main'
    );

    assert.equal(spotlightResult.unit.spotlights.length, 2);
    assert.ok(spotlightResult.unit.spotlights[0].id);
    assert.equal(spotlightResult.unit.spotlights[1].id, 'fixed-id');
  });

  it('normalizes media hotspots and media metadata', () => {
    const hotspotResult = inventoryService.updateMediaHotspots(
      'unit-story',
      [{ x: 2, y: -1, label: 'Wheel', description: 'New rims' }],
      'main'
    );
    assert.equal(hotspotResult.unit.mediaHotspots[0].x, 1);
    assert.equal(hotspotResult.unit.mediaHotspots[0].y, 0);

    const mediaResult = inventoryService.updateMedia(
      'unit-story',
      {
        photos: [{ url: 'https://images.test/photo.jpg', isHero: true, optimizedUrl: 'https://images.test/opt.webp' }],
        heroVideo: { url: 'https://videos.test/hero.mp4', durationSeconds: 30 },
        virtualTour: { provider: 'matterport', url: 'https://tour.test' }
      },
      'main'
    );
    assert.equal(mediaResult.unit.media.photos[0].optimizedUrl, 'https://images.test/opt.webp');
    assert.equal(mediaResult.unit.media.heroVideo.url, 'https://videos.test/hero.mp4');
    assert.equal(mediaResult.unit.media.virtualTour.provider, 'matterport');
  });
});

describe('inventory schema export', () => {
  let persistMock;

  beforeEach(() => {
    persistMock = mock.method(persist, 'seoProfiles', () => {});
    datasets.seoProfiles = [];
  });

  afterEach(() => {
    persistMock?.mock.restore();
  });

  it('builds RecreationalVehicle JSON-LD payload', () => {
    const unit = baseUnit({
      id: 'schema-1',
      slug: 'adventure',
      totalPrice: 123000,
      media: { photos: [{ url: 'https://images.test/hero.jpg', isHero: true }] },
      category: 'Motorhome',
      subcategory: 'Class A',
      beds: 4,
      fuelType: 'diesel'
    });
    const schema = inventorySchemaService.buildJsonLd(unit, 'main');
    assert.equal(schema['@type'], 'RecreationalVehicle');
    assert.equal(schema.image, 'https://images.test/hero.jpg');
    assert.equal(schema.vehicleConfiguration, 'Class A');
    assert.equal(schema.url, '/inventory/adventure');
    assert.equal(schema.numberOfBeds, 4);
  });
});
