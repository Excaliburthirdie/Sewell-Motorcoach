const { datasets, persist } = require('./state');
const { sanitizePayloadStrings } = require('./shared');
const { matchesTenant } = require('./tenantService');
const { clampNumber } = require('./shared');

function getForTenant(tenantId) {
  return datasets.settings.find(setting => matchesTenant(setting.tenantId, tenantId)) || datasets.settings[0];
}

function update(payload, tenantId) {
  const index = datasets.settings.findIndex(setting => matchesTenant(setting.tenantId, tenantId));
  const hours = payload.hours || datasets.settings[index]?.hours;
  const sanitized = sanitizePayloadStrings(payload, ['dealershipName', 'address', 'city', 'state', 'zip', 'country', 'currency', 'phone', 'email']);

  const updated = {
    ...(datasets.settings[index] || {}),
    ...sanitized,
    hours
  };

  if (index === -1) {
    datasets.settings.push(updated);
  } else {
    datasets.settings[index] = updated;
  }
  persist.settings(datasets.settings);
  return { settings: updated };
}

function getBadgeRules(tenantId) {
  const settings = getForTenant(tenantId) || {};
  return settings.badgeRules || {};
}

function updateBadgeRules(payload, tenantId) {
  const index = datasets.settings.findIndex(setting => matchesTenant(setting.tenantId, tenantId));
  const current = index === -1 ? { tenantId } : datasets.settings[index];
  const badgeRules = {
    ...current.badgeRules,
    nationalParkMaxLength:
      payload.nationalParkMaxLength !== undefined
        ? Number(payload.nationalParkMaxLength)
        : current.badgeRules?.nationalParkMaxLength,
    offGridEnabled:
      payload.offGridEnabled === undefined ? current.badgeRules?.offGridEnabled : Boolean(payload.offGridEnabled),
    customRules: payload.customRules !== undefined ? payload.customRules : current.badgeRules?.customRules || []
  };
  const updated = { ...current, badgeRules };
  if (index === -1) {
    datasets.settings.push(updated);
  } else {
    datasets.settings[index] = updated;
  }
  persist.settings(datasets.settings);
  return { badgeRules };
}

function getLeadScoringRules(tenantId) {
  const settings = getForTenant(tenantId) || {};
  return settings.leadScoringRules || {};
}

function updateLeadScoringRules(payload, tenantId) {
  const index = datasets.settings.findIndex(setting => matchesTenant(setting.tenantId, tenantId));
  const current = index === -1 ? { tenantId } : datasets.settings[index];

  const segmentRules = Array.isArray(payload.segmentRules)
    ? payload.segmentRules.map(rule => ({
        id: rule.id,
        minScore: clampNumber(rule.minScore, 0)
      }))
    : current.leadScoringRules?.segmentRules;

  const leadScoringRules = {
    ...current.leadScoringRules,
    baseScore: clampNumber(payload.baseScore, current.leadScoringRules?.baseScore || 0),
    repeatViewWeight: clampNumber(payload.repeatViewWeight, current.leadScoringRules?.repeatViewWeight || 0),
    highValuePriceThreshold: clampNumber(
      payload.highValuePriceThreshold,
      current.leadScoringRules?.highValuePriceThreshold || 0
    ),
    highValueScore: clampNumber(payload.highValueScore, current.leadScoringRules?.highValueScore || 0),
    engagementDurationMs: clampNumber(
      payload.engagementDurationMs,
      current.leadScoringRules?.engagementDurationMs || 0
    ),
    scrollDepthThreshold: clampNumber(
      payload.scrollDepthThreshold,
      current.leadScoringRules?.scrollDepthThreshold || 0
    ),
    engagementScore: clampNumber(payload.engagementScore, current.leadScoringRules?.engagementScore || 0),
    engagementCap: clampNumber(payload.engagementCap, current.leadScoringRules?.engagementCap || 0),
    submissionScore: clampNumber(payload.submissionScore, current.leadScoringRules?.submissionScore || 0),
    alertEngagementScore: clampNumber(
      payload.alertEngagementScore,
      current.leadScoringRules?.alertEngagementScore || 0
    ),
    alertCap: clampNumber(payload.alertCap, current.leadScoringRules?.alertCap || 0),
    segmentRules: segmentRules || current.leadScoringRules?.segmentRules
  };

  const updated = { ...current, leadScoringRules };
  if (index === -1) {
    datasets.settings.push(updated);
  } else {
    datasets.settings[index] = updated;
  }
  persist.settings(datasets.settings);
  return { leadScoringRules };
}

module.exports = {
  getForTenant,
  update,
  getBadgeRules,
  updateBadgeRules,
  getLeadScoringRules,
  updateLeadScoringRules
};
