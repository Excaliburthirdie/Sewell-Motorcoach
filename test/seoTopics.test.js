const assert = require('node:assert/strict');
const { describe, it, beforeEach } = require('node:test');

const { datasets } = require('../src/services/state');
const seoService = require('../src/services/seoService');

describe('seoService.topics', () => {
  beforeEach(() => {
    datasets.contentPages = [];
  });

  it('indexes topics and related topics for a tenant', () => {
    datasets.contentPages = [
      {
        id: 'p1',
        title: 'Bunkhouse RVs',
        body: 'Body',
        slug: 'bunkhouse',
        topic: 'bunkhouse-rvs',
        relatedTopics: ['family-camping'],
        tenantId: 'main'
      },
      {
        id: 'p2',
        title: 'Family Camping',
        body: 'Body',
        slug: 'family',
        topic: 'family-camping',
        relatedTopics: ['bunkhouse-rvs', 'roadtrip'],
        tenantId: 'main'
      },
      {
        id: 'p3',
        title: 'Other tenant page',
        body: 'Body',
        slug: 'other',
        topic: 'bunkhouse-rvs',
        tenantId: 'other'
      }
    ];

    const topics = seoService.topics('main');
    const bunkhouse = topics.find(t => t.topic === 'bunkhouse-rvs');
    const family = topics.find(t => t.topic === 'family-camping');

    assert.equal(topics.length, 3);
    assert.ok(bunkhouse);
    assert.equal(bunkhouse.pages.length, 1);
    assert.deepEqual(bunkhouse.relatedTopics.sort(), ['family-camping']);
    assert.ok(family);
    assert.deepEqual(
      family.relatedTopics.sort(),
      ['bunkhouse-rvs', 'roadtrip'].sort()
    );
  });
});
