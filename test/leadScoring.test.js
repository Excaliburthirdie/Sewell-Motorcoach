const assert = require('node:assert/strict');
const { describe, it, beforeEach, afterEach, mock } = require('node:test');

const { datasets, persist } = require('../src/services/state');
const leadScoringService = require('../src/services/leadScoringService');

describe('lead scoring engine', () => {
  let persistMocks;

  beforeEach(() => {
    persistMocks = [
      mock.method(persist, 'leads', () => {}),
      mock.method(persist, 'events', () => {}),
      mock.method(persist, 'notifications', () => {}),
      mock.method(persist, 'settings', () => {})
    ];
    datasets.leads = [
      {
        id: 'lead-1',
        tenantId: 'main',
        createdAt: new Date().toISOString(),
        leadScore: 0,
        scoreReasons: [],
        segments: [],
        scoreHistory: []
      },
      {
        id: 'lead-2',
        tenantId: 'main',
        createdAt: new Date().toISOString(),
        leadScore: 0,
        scoreReasons: [],
        segments: [],
        scoreHistory: []
      }
    ];
    datasets.notifications = [];
    datasets.settings = [{ tenantId: 'main' }];
  });

  afterEach(() => {
    persistMocks.forEach(spy => spy.mock?.restore?.());
  });

  it('boosts repeated views and high-value interest', () => {
    datasets.inventory = [{ id: 'unit1', tenantId: 'main', stockNumber: 'X1', price: 250000 }];
    datasets.events = [
      { id: 'e1', tenantId: 'main', type: 'view', stockNumber: 'x1', leadId: 'lead-1', createdAt: new Date().toISOString() },
      { id: 'e2', tenantId: 'main', type: 'view', stockNumber: 'x1', leadId: 'lead-1', createdAt: new Date().toISOString() }
    ];

    const result = leadScoringService.recomputeLead('lead-1', 'main');

    assert.ok(result.leadScore >= 17, 'score reflects repeat + high value');
    assert.ok(result.scoreReasons.some(reason => reason.includes('Repeat interest')));
    assert.ok(result.scoreReasons.some(reason => reason.includes('High-value')));
    assert.ok(datasets.leads[0].segments.includes('vip') || datasets.leads[0].segments.includes('engaged'));
    assert.equal(datasets.leads[0].leadScore, result.leadScore);
  });

  it('counts deep engagement and alert/email activity', () => {
    datasets.inventory = [{ id: 'unit1', tenantId: 'main', stockNumber: 'Y1', price: 100000 }];
    datasets.notifications = [
      { id: 'n1', tenantId: 'main', contactId: 'lead-1', status: 'sent', createdAt: new Date().toISOString() }
    ];
    datasets.events = [
      {
        id: 'e3',
        tenantId: 'main',
        type: 'view',
        stockNumber: 'Y1',
        section: 'pricing-section',
        scrollDepth: 85,
        durationMs: 120000,
        leadId: 'lead-1',
        createdAt: new Date().toISOString()
      },
      { id: 'e4', tenantId: 'main', type: 'lead_submit', leadId: 'lead-1', createdAt: new Date().toISOString() },
      {
        id: 'e5',
        tenantId: 'main',
        type: 'view',
        stockNumber: 'Y1',
        interaction: 'email',
        leadId: 'lead-1',
        createdAt: new Date().toISOString()
      }
    ];

    const result = leadScoringService.recomputeLead('lead-1', 'main');

    assert.ok(result.leadScore > 30, 'score includes engagement and alerts');
    assert.ok(result.scoreReasons.some(reason => reason.includes('Deep engagement')));
    assert.ok(result.scoreReasons.some(reason => reason.includes('Alert/email engagement')));
    assert.ok(result.scoreReasons.some(reason => reason.includes('Form submissions')));
    assert.ok(datasets.leads[0].scoreHistory.length > 0, 'history recorded');
  });

  it('bulk recompute respects provided ids', () => {
    datasets.inventory = [];
    datasets.events = [];
    const result = leadScoringService.recomputeBulk({ leadIds: ['lead-1'] }, 'main');
    assert.equal(result.updatedCount, 1);
    assert.notEqual(datasets.leads[0].scoreUpdatedAt, undefined);
    assert.equal(datasets.leads[1].leadScore, 0);
  });
});
