const assert = require('node:assert/strict');
const { describe, it, beforeEach, afterEach, mock } = require('node:test');

const { datasets, persist } = require('../src/services/state');
const campaignService = require('../src/services/campaignService');
const eventService = require('../src/services/eventService');

describe('campaigns and attribution', () => {
  let persistMocks;

  beforeEach(() => {
    persistMocks = [
      mock.method(persist, 'campaigns', () => {}),
      mock.method(persist, 'events', () => {}),
      mock.method(persist, 'leads', () => {})
    ];
    datasets.campaigns = [];
    datasets.events = [];
    datasets.leads = [
      {
        id: 'lead-1',
        tenantId: 'main',
        createdAt: new Date().toISOString(),
        leadScore: 40
      }
    ];
  });

  afterEach(() => {
    persistMocks.forEach(spy => spy.mock?.restore?.());
  });

  it('creates campaigns and enforces unique slug per tenant', () => {
    const created = campaignService.create({ name: 'Summer Push', slug: 'summer', channel: 'google-ads' }, 'main');
    assert.ok(created.campaign.id);

    const duplicate = campaignService.create({ name: 'Duplicate', slug: 'summer', channel: 'email' }, 'main');
    assert.ok(duplicate.error);
  });

  it('captures attribution from events and reports performance', () => {
    const campaign = campaignService.create({ name: 'Launch', slug: 'launch', channel: 'facebook' }, 'main').campaign;
    datasets.events = [];

    const createdEvent = eventService.create(
      {
        type: 'view',
        utmCampaign: 'launch',
        leadId: 'lead-1'
      },
      'main'
    );
    assert.equal(createdEvent.event.campaignId, campaign.id);
    assert.equal(datasets.leads[0].firstTouchCampaignId, campaign.id);
    assert.equal(datasets.leads[0].lastTouchCampaignId, campaign.id);

    eventService.create({ type: 'view', utmCampaign: 'launch' }, 'main');

    const report = campaignService.performance('main');
    assert.equal(report[0].metrics.sessions, 2);
    assert.equal(report[0].metrics.leads, 1);
    assert.equal(report[0].metrics.averageLeadScore, 40);
  });
});
