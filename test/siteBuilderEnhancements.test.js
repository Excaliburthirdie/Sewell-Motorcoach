const assert = require('node:assert/strict');
const { describe, it, beforeEach, afterEach, mock } = require('node:test');

const { datasets, persist } = require('../src/services/state');
const contentPageService = require('../src/services/contentPageService');
const blockPresetService = require('../src/services/blockPresetService');
const experimentService = require('../src/services/experimentService');
const analyticsService = require('../src/services/analyticsService');

describe('contentPageService publishing and preview', () => {
  let persistMocks;

  beforeEach(() => {
    datasets.contentPages = [];
    persistMocks = [mock.method(persist, 'contentPages', () => {})];
  });

  afterEach(() => {
    persistMocks.forEach(m => m.mock.restore());
  });

  it('publishes a draft immediately', () => {
    const created = contentPageService.create({ title: 'Draft', body: 'Copy' }, 'main', 'editor@example.com');
    assert.equal(created.page.status, 'draft');
    const result = contentPageService.publish(created.page.id, 'main', undefined, 'publisher@example.com');
    assert.equal(result.page.status, 'published');
    assert.ok(result.page.publishAt);
    assert.equal(result.page.publishedBy, 'publisher@example.com');
  });

  it('returns draft only in preview mode', () => {
    const created = contentPageService.create({ title: 'Previewable', body: 'Copy', slug: 'preview' }, 'main');
    const live = contentPageService.findBySlug('preview', 'main');
    assert.equal(live, undefined);
    const preview = contentPageService.findBySlug('preview', 'main', { preview: true });
    assert.ok(preview);
  });

  it('persists topics and related topics on create and update', () => {
    const created = contentPageService.create(
      { title: 'Topic Page', body: 'Copy', topic: 'bunkhouse', relatedTopics: ['family ', 'family', 'adventure'] },
      'main'
    );
    assert.equal(created.page.topic, 'bunkhouse');
    assert.deepEqual(created.page.relatedTopics, ['family', 'adventure']);

    const updated = contentPageService.update(
      created.page.id,
      { topic: 'family-camping', relatedTopics: ['bunkhouse', 'premium'] },
      'main'
    );
    assert.equal(updated.page.topic, 'family-camping');
    assert.deepEqual(updated.page.relatedTopics, ['bunkhouse', 'premium']);
  });
});

describe('blockPresetService', () => {
  let persistMocks;
  beforeEach(() => {
    datasets.blockPresets = [];
    persistMocks = [mock.method(persist, 'blockPresets', () => {})];
  });

  afterEach(() => {
    persistMocks.forEach(m => m.mock.restore());
  });

  it('creates, lists, filters, and updates presets', () => {
    const created = blockPresetService.create({ type: 'hero', label: 'Default Hero', props: { align: 'center' } }, 'main');
    assert.equal(created.preset.type, 'hero');
    const list = blockPresetService.list({}, 'main');
    assert.equal(list.length, 1);
    const filtered = blockPresetService.list({ type: 'gallery' }, 'main');
    assert.equal(filtered.length, 0);
    const updated = blockPresetService.update(created.preset.id, { label: 'Updated Hero' }, 'main');
    assert.equal(updated.preset.label, 'Updated Hero');
  });
});

describe('experimentService metrics', () => {
  let persistMocks;
  beforeEach(() => {
    datasets.experiments = [];
    datasets.analytics = { events: [] };
    persistMocks = [
      mock.method(persist, 'experiments', () => {}),
      mock.method(persist, 'analytics', () => {})
    ];
  });

  afterEach(() => {
    persistMocks.forEach(m => m.mock.restore());
  });

  it('summarizes variant metrics from analytics events', () => {
    const created = experimentService.create(
      {
        name: 'Homepage CTA',
        targetSlug: '/home',
        variantType: 'page',
        variants: [{ id: 'A', weight: 1 }, { id: 'B', weight: 1 }]
      },
      'main'
    );
    analyticsService.recordEvent({ type: 'view', experimentId: created.experiment.id, variantId: 'A', metrics: { clicks: 2 } }, 'main');
    analyticsService.recordEvent({ type: 'view', experimentId: created.experiment.id, variantId: 'A', metrics: { clicks: 1 } }, 'main');
    analyticsService.recordEvent({ type: 'view', experimentId: created.experiment.id, variantId: 'B', metrics: { clicks: 3 } }, 'main');

    const result = experimentService.getById(created.experiment.id, 'main');
    const variantA = result.metrics.find(m => m.id === 'A');
    const variantB = result.metrics.find(m => m.id === 'B');
    assert.equal(variantA.count, 2);
    assert.equal(variantA.metrics.clicks, 3);
    assert.equal(variantB.count, 1);
    assert.equal(variantB.metrics.clicks, 3);
  });
});
