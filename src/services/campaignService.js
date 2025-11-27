const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');
const { escapeOutputPayload, sanitizePayloadStrings, validateFields } = require('./shared');

function safeCampaign(campaign) {
  return escapeOutputPayload(campaign);
}

function normalizeSlug(slug) {
  return slug ? slug.trim().toLowerCase() : slug;
}

function list(_query, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  return datasets.campaigns.filter(entry => matchesTenant(entry.tenantId, tenant)).map(safeCampaign);
}

function findBySlug(slug, tenantId) {
  const normalized = normalizeSlug(slug);
  if (!normalized) return undefined;
  return datasets.campaigns.find(c => matchesTenant(c.tenantId, tenantId) && normalizeSlug(c.slug) === normalized);
}

function create(payload, tenantId) {
  const requiredError = validateFields(payload, ['name', 'slug', 'channel']);
  if (requiredError) return { error: requiredError };

  if (findBySlug(payload.slug, tenantId)) {
    return { error: 'Campaign slug must be unique per tenant' };
  }

  const sanitized = sanitizePayloadStrings(payload, [
    'name',
    'slug',
    'channel',
    'targetLandingPageSlug',
    'utmSource',
    'utmMedium',
    'utmCampaign'
  ]);

  const campaign = attachTenant(
    {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      name: sanitized.name,
      slug: normalizeSlug(sanitized.slug),
      channel: sanitized.channel,
      startAt: sanitized.startAt || null,
      endAt: sanitized.endAt || null,
      targetLandingPageSlug: sanitized.targetLandingPageSlug || null,
      utmSource: sanitized.utmSource || null,
      utmMedium: sanitized.utmMedium || null,
      utmCampaign: sanitized.utmCampaign || null
    },
    tenantId
  );

  datasets.campaigns.push(campaign);
  persist.campaigns(datasets.campaigns);
  return { campaign: safeCampaign(campaign) };
}

function update(id, payload, tenantId) {
  const index = datasets.campaigns.findIndex(c => c.id === id && matchesTenant(c.tenantId, tenantId));
  if (index === -1) return { notFound: true };

  const sanitized = sanitizePayloadStrings(payload, [
    'name',
    'slug',
    'channel',
    'targetLandingPageSlug',
    'utmSource',
    'utmMedium',
    'utmCampaign'
  ]);

  if (sanitized.slug && findBySlug(sanitized.slug, tenantId) && normalizeSlug(sanitized.slug) !== datasets.campaigns[index].slug) {
    return { error: 'Campaign slug must be unique per tenant' };
  }

  datasets.campaigns[index] = {
    ...datasets.campaigns[index],
    ...sanitized,
    slug: sanitized.slug ? normalizeSlug(sanitized.slug) : datasets.campaigns[index].slug,
    updatedAt: new Date().toISOString()
  };

  persist.campaigns(datasets.campaigns);
  return { campaign: safeCampaign(datasets.campaigns[index]) };
}

function touchLeadAttribution(leadId, campaignId, tenantId) {
  const index = datasets.leads.findIndex(lead => lead.id === leadId && matchesTenant(lead.tenantId, tenantId));
  if (index === -1) return { notFound: true };
  const existing = datasets.leads[index];
  datasets.leads[index] = {
    ...existing,
    firstTouchCampaignId: existing.firstTouchCampaignId || campaignId,
    lastTouchCampaignId: campaignId
  };
  persist.leads(datasets.leads);
  return { lead: datasets.leads[index] };
}

function performance(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const campaigns = datasets.campaigns.filter(c => matchesTenant(c.tenantId, tenant));
  const events = (datasets.events || []).filter(event => matchesTenant(event.tenantId, tenant));
  const leads = (datasets.leads || []).filter(lead => matchesTenant(lead.tenantId, tenant));

  return campaigns.map(campaign => {
    const campaignEvents = events.filter(
      event => event.campaignId === campaign.id || normalizeSlug(event.utmCampaign) === campaign.slug
    );
    const campaignLeads = leads.filter(
      lead => lead.firstTouchCampaignId === campaign.id || lead.lastTouchCampaignId === campaign.id
    );
    const sessions = campaignEvents.length;
    const leadScores = campaignLeads.map(lead => lead.leadScore || 0);
    const averageLeadScore = leadScores.length
      ? Math.round(leadScores.reduce((sum, value) => sum + value, 0) / leadScores.length)
      : 0;

    return safeCampaign({
      ...campaign,
      metrics: {
        sessions,
        leads: campaignLeads.length,
        averageLeadScore
      }
    });
  });
}

module.exports = {
  list,
  create,
  update,
  findBySlug,
  touchLeadAttribution,
  performance
};
