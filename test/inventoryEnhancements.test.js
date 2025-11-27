const assert = require('node:assert/strict');
const { describe, it, beforeEach, afterEach, mock } = require('node:test');

const { datasets, persist } = require('../src/services/state');
const inventoryService = require('../src/services/inventoryService');
const inventoryRevisionService = require('../src/services/inventoryRevisionService');
const spotlightTemplateService = require('../src/services/spotlightTemplateService');
const settingsService = require('../src/services/settingsService');

const tenantId = 'main';

describe('inventory storytelling enhancements', () => {
  let persistMocks;
  beforeEach(() => {
    persistMocks = [
      mock.method(persist, 'inventory', () => {}),
      mock.method(persist, 'inventoryRevisions', () => {}),
      mock.method(persist, 'spotlightTemplates', () => {}),
      mock.method(persist, 'settings', () => {})
    ];
    datasets.inventory = [
      {
        id: 'inv-1',
        stockNumber: 'STK-1',
        vin: 'VIN-12345678901',
        name: 'Coach One',
        condition: 'new',
        price: 100000,
        length: 29,
        tenantId,
        spotlights: []
      },
      {
        id: 'inv-2',
        stockNumber: 'STK-2',
        vin: 'VIN-12345678902',
        name: 'Coach Two',
        condition: 'new',
        price: 110000,
        length: 33,
        tenantId,
        spotlights: []
      }
    ];
    datasets.inventoryRevisions = [];
    datasets.spotlightTemplates = [];
    datasets.settings = [{ tenantId, badgeRules: {}, dealershipName: 'Test Dealer' }];
  });

  afterEach(() => {
    persistMocks.forEach(m => m.mock.restore());
  });

  it('captures and restores revisions for storytelling fields', () => {
    const updateResult = inventoryService.updateSpotlights(
      'inv-1',
      [{ title: 'Freshly detailed', description: 'Ready for adventures' }],
      tenantId,
      'storyteller@test.dev'
    );
    assert.ok(updateResult.unit.spotlights.length);
    const revisions = inventoryRevisionService.listRevisions('inv-1', tenantId);
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0].field, 'spotlights');
    assert.equal(revisions[0].changedBy, 'storyteller@test.dev');
    assert.ok(revisions[0].revisionId);
    assert.deepEqual(revisions[0].nextValue[0].title, 'Freshly detailed');

    const restored = inventoryRevisionService.restoreRevision('inv-1', revisions[0].id, tenantId, 'admin@test');
    assert.ok(restored.unit.spotlights.length === 0);

    const restoreAudit = inventoryRevisionService.listRevisions('inv-1', tenantId)[0];
    assert.equal(restoreAudit.changedBy, 'admin@test');
    assert.equal(restoreAudit.previousValue[0].title, 'Freshly detailed');
    assert.equal(restoreAudit.nextValue.length, 0);
  });

  it('preserves snapshot integrity for deep objects', () => {
    const original = [{ title: 'Solar Ready', description: 'Panels installed' }];
    datasets.inventory[0].spotlights = original;
    inventoryService.updateSpotlights('inv-1', [{ title: 'New title' }], tenantId, 'editor');
    original[0].title = 'Mutated';
    const revision = inventoryRevisionService.listRevisions('inv-1', tenantId).find(r => r.field === 'spotlights');
    assert.equal(revision.previousValue[0].title, 'Solar Ready');
  });

  it('rejects restore attempts across tenants', () => {
    datasets.inventory.push({ id: 'inv-3', tenantId: 'other', spotlights: [] });
    datasets.inventoryRevisions.push({
      id: 'rev-other',
      revisionId: 'rev-other',
      inventoryId: 'inv-3',
      tenantId: 'other',
      field: 'spotlights',
      previousValue: [],
      changedBy: 'user',
      changedAt: new Date().toISOString()
    });
    const restore = inventoryRevisionService.restoreRevision('inv-3', 'rev-other', tenantId, 'intruder');
    assert.ok(restore.notFound);
  });

  it('applies spotlight templates in bulk', () => {
    const created = spotlightTemplateService.create(
      {
        name: 'Value hits',
        spotlights: [
          { title: 'Solar Ready', description: 'Panels installed' },
          { title: 'Warranty', description: 'Transferable coverage' }
        ]
      },
      tenantId,
      'tester'
    );
    const result = spotlightTemplateService.applyTemplate(created.template.id, ['inv-1', 'inv-2'], tenantId);
    assert.deepEqual(result.applied.sort(), ['inv-1', 'inv-2']);
    assert.equal(datasets.inventory[0].spotlights.length, 2);
    assert.equal(datasets.inventory[1].spotlights[0].title, 'Solar Ready');
  });

  it('honors configurable badge rules for previews and recompute', () => {
    settingsService.updateBadgeRules(
      {
        nationalParkMaxLength: 35,
        offGridEnabled: false,
        customRules: [{ label: 'Diesel Intent', matchField: 'engine', matchValue: 'diesel' }]
      },
      tenantId
    );

    const preview = inventoryService.previewBadges({ length: 34, engine: 'diesel', solar: ['panel'] }, tenantId);
    assert.ok(preview.includes('National Park Friendly'));
    assert.ok(preview.includes('Diesel Intent'));
    assert.ok(!preview.includes('Off-Grid Ready'));

    datasets.inventory[0].engine = 'diesel';
    datasets.inventory[0].length = 34;
    const recompute = inventoryService.recomputeBadges({ inventoryIds: ['inv-1'] }, tenantId);
    assert.equal(recompute.updated, 1);
    assert.ok(datasets.inventory[0].badges.includes('Diesel Intent'));
  });
});
