const { datasets, persist } = require('./state');
const settingsService = require('./settingsService');
const { matchesTenant, normalizeTenantId } = require('./tenantService');
const { clampNumber } = require('./shared');

const defaultRules = {
  baseScore: 0,
  repeatViewWeight: 5,
  highValuePriceThreshold: 150000,
  highValueScore: 12,
  engagementDurationMs: 60000,
  scrollDepthThreshold: 75,
  engagementScore: 6,
  engagementCap: 30,
  submissionScore: 20,
  alertEngagementScore: 8,
  alertCap: 16,
  segmentRules: [
    { id: 'hot', minScore: 50 },
    { id: 'warm', minScore: 25 },
    { id: 'engaged', minScore: 10 }
  ]
};

function resolveRules(tenantId) {
  const tenantRules = settingsService.getLeadScoringRules(tenantId) || {};
  return {
    ...defaultRules,
    ...tenantRules,
    segmentRules: tenantRules.segmentRules || defaultRules.segmentRules
  };
}

function normalizeNumber(value) {
  if (value === undefined || value === null) return undefined;
  return clampNumber(value, undefined);
}

function selectEventsForLead(leadId, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  return (datasets.events || [])
    .filter(event => matchesTenant(event.tenantId, tenant))
    .filter(event => event.leadId === leadId);
}

function selectNotificationsForLead(leadId, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  return (datasets.notifications || [])
    .filter(notification => matchesTenant(notification.tenantId, tenant))
    .filter(notification => notification.contactId === leadId);
}

function computeScorePayload(lead, tenantId) {
  const rules = resolveRules(tenantId);
  const events = selectEventsForLead(lead.id, tenantId);
  const notifications = selectNotificationsForLead(lead.id, tenantId);
  let score = rules.baseScore;
  const reasons = [];

  const viewEvents = events.filter(event => event.type === 'view');
  const viewCounts = viewEvents.reduce((acc, event) => {
    if (!event.stockNumber) return acc;
    const key = event.stockNumber.toUpperCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  Object.entries(viewCounts).forEach(([stock, count]) => {
    if (count > 1) {
      const bonus = (count - 1) * rules.repeatViewWeight;
      score += bonus;
      reasons.push(`Repeat interest in ${stock} (${count} views, +${bonus})`);
    }
  });

  const inventoryMap = new Map(
    (datasets.inventory || [])
      .filter(unit => matchesTenant(unit.tenantId, tenantId) && unit.stockNumber)
      .map(unit => [unit.stockNumber.toUpperCase(), unit])
  );

  const highValueStocks = new Set();
  viewEvents.forEach(event => {
    const unit = event.stockNumber ? inventoryMap.get(event.stockNumber.toUpperCase()) : null;
    if (!unit || unit.price === undefined || unit.price === null) return;
    if (unit.price >= rules.highValuePriceThreshold) {
      highValueStocks.add(unit.stockNumber.toUpperCase());
    }
  });

  highValueStocks.forEach(stock => {
    score += rules.highValueScore;
    reasons.push(`High-value unit interest (${stock}, +${rules.highValueScore})`);
  });

  const engagementEvents = viewEvents.filter(event => {
    const durationMs = normalizeNumber(event.durationMs) || 0;
    const scrollDepth = normalizeNumber(event.scrollDepth) || 0;
    const section = (event.section || '').toLowerCase();
    return (
      durationMs >= rules.engagementDurationMs ||
      scrollDepth >= rules.scrollDepthThreshold ||
      section.includes('pricing') ||
      section.includes('warranty')
    );
  });

  if (engagementEvents.length) {
    const engagementScore = Math.min(rules.engagementCap, engagementEvents.length * rules.engagementScore);
    score += engagementScore;
    reasons.push(`Deep engagement (${engagementEvents.length} events, +${engagementScore})`);
  }

  const submissions = events.filter(event => event.type === 'lead_submit').length;
  if (submissions) {
    const submitScore = submissions * rules.submissionScore;
    score += submitScore;
    reasons.push(`Form submissions (${submissions}, +${submitScore})`);
  }

  const alertEngagements = events.filter(event => {
    const interaction = (event.interaction || '').toLowerCase();
    return interaction === 'alert' || interaction === 'email';
  }).length;

  const notificationEngagements = notifications.filter(note => note.status === 'sent').length;
  const totalEngagements = alertEngagements + notificationEngagements;

  if (totalEngagements) {
    const alertScore = Math.min(rules.alertCap, totalEngagements * rules.alertEngagementScore);
    score += alertScore;
    reasons.push(`Alert/email engagement (${totalEngagements}, +${alertScore})`);
  }

  const segments = rules.segmentRules
    .filter(rule => score >= rule.minScore)
    .map(rule => rule.id);

  return {
    leadScore: Math.max(0, Math.round(score)),
    scoreReasons: reasons,
    segments
  };
}

function applyScore(index, payload) {
  const now = new Date().toISOString();
  const history = datasets.leads[index].scoreHistory || [];
  const nextHistory = [...history, { score: payload.leadScore, reasons: payload.scoreReasons, computedAt: now }].slice(-20);

  datasets.leads[index] = {
    ...datasets.leads[index],
    ...payload,
    scoreUpdatedAt: now,
    scoreHistory: nextHistory
  };
}

function recomputeLead(leadId, tenantId) {
  const index = datasets.leads.findIndex(lead => lead.id === leadId && matchesTenant(lead.tenantId, tenantId));
  if (index === -1) return { notFound: true };
  const payload = computeScorePayload(datasets.leads[index], tenantId);
  applyScore(index, payload);
  persist.leads(datasets.leads);
  return { ...payload, leadId };
}

function recomputeBulk(body = {}, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const scoped = datasets.leads.filter(lead => matchesTenant(lead.tenantId, tenant));
  const ids = body.all ? scoped.map(lead => lead.id) : body.leadIds || [];

  const updated = [];
  ids.forEach(id => {
    const result = recomputeLead(id, tenantId);
    if (!result.notFound) updated.push(result);
  });
  return { updatedCount: updated.length, results: updated };
}

module.exports = {
  recomputeLead,
  recomputeBulk,
  resolveRules
};
