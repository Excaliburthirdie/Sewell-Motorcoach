const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { escapeOutputPayload, sanitizePayloadStrings } = require('./shared');
const { matchesTenant, normalizeTenantId } = require('./tenantService');
const leadService = require('./leadService');
const inventoryService = require('./inventoryService');
const reviewService = require('./reviewService');

function safe(payload) {
  return escapeOutputPayload(payload);
}

function recordEvent(payload, tenantId) {
  const sanitized = sanitizePayloadStrings(payload, ['type', 'resourceType', 'resourceId', 'note', 'channel']);
  const event = {
    id: randomUUID(),
    tenantId: normalizeTenantId(tenantId),
    createdAt: new Date().toISOString(),
    type: sanitized.type || 'custom',
    resourceType: sanitized.resourceType,
    resourceId: sanitized.resourceId,
    channel: sanitized.channel,
    note: sanitized.note,
    metrics: payload.metrics || {}
  };
  datasets.analytics.events = datasets.analytics.events || [];
  datasets.analytics.events.push(event);
  persist.analytics(datasets.analytics);
  return { event: safe(event) };
}

function calculateInventoryPerformance(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const leads = leadService.list({}, tenant).items || leadService.list({}, tenant) || [];
  const reviews = reviewService.list({}, tenant) || [];
  const inventory = inventoryService.list({}, tenant).items || inventoryService.list({}, tenant) || [];

  const leadCounts = leads.reduce((acc, lead) => {
    if (lead.interestedStockNumber) {
      acc[lead.interestedStockNumber] = (acc[lead.interestedStockNumber] || 0) + 1;
    }
    return acc;
  }, {});

  const reviewCounts = reviews.reduce((acc, review) => {
    if (review.relatedInventoryId) {
      acc[review.relatedInventoryId] = acc[review.relatedInventoryId] || { count: 0, ratingTotal: 0 };
      acc[review.relatedInventoryId].count += 1;
      acc[review.relatedInventoryId].ratingTotal += review.rating || 0;
    }
    return acc;
  }, {});

  return inventory
    .map(unit => {
      const leadsForUnit = leadCounts[unit.stockNumber] || leadCounts[unit.id] || 0;
      const reviewData = reviewCounts[unit.id] || { count: 0, ratingTotal: 0 };
      const avgRating = reviewData.count ? reviewData.ratingTotal / reviewData.count : 0;
      const interestScore = leadsForUnit * 2 + avgRating * 3 + (unit.featured ? 5 : 0);
      return {
        id: unit.id,
        stockNumber: unit.stockNumber,
        name: unit.name,
        category: unit.category,
        condition: unit.condition,
        location: unit.location,
        leads: leadsForUnit,
        reviews: reviewData.count,
        avgRating,
        interestScore
      };
    })
    .sort((a, b) => b.interestScore - a.interestScore)
    .slice(0, 10);
}

function rollupEvents(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const events = (datasets.analytics.events || []).filter(evt => matchesTenant(evt.tenantId, tenant));
  const counts = events.reduce((acc, event) => {
    acc[event.type] = (acc[event.type] || 0) + 1;
    return acc;
  }, {});
  const recent = events.slice(-50).map(safe);
  return { counts, recent };
}

function bestLeadSources(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const leads = leadService.list({}, tenant).items || leadService.list({}, tenant) || [];
  const sources = leads.reduce((acc, lead) => {
    const key = lead.utmSource || lead.referrer || 'direct';
    acc[key] = acc[key] || { total: 0, won: 0 };
    acc[key].total += 1;
    if (lead.status === 'won') acc[key].won += 1;
    return acc;
  }, {});
  return Object.entries(sources)
    .map(([source, data]) => ({
      source,
      total: data.total,
      won: data.won,
      conversionRate: data.total ? Math.round((data.won / data.total) * 100) : 0
    }))
    .sort((a, b) => b.total - a.total);
}

function dashboard(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const events = rollupEvents(tenant);
  const inventoryPerformance = calculateInventoryPerformance(tenant);
  const leadBreakdown = bestLeadSources(tenant);
  const leads = leadService.list({}, tenant).items || [];
  const won = leads.filter(lead => lead.status === 'won').length;
  const lost = leads.filter(lead => lead.status === 'lost').length;
  const open = leads.length - won - lost;
  const conversionRate = leads.length ? Math.round((won / leads.length) * 100) : 0;

  return {
    tenantId: tenant,
    events,
    inventoryPerformance,
    leadBreakdown,
    conversions: {
      total: leads.length,
      won,
      lost,
      open,
      conversionRate
    }
  };
}

module.exports = {
  recordEvent,
  dashboard,
  calculateInventoryPerformance,
  rollupEvents,
  bestLeadSources
};
