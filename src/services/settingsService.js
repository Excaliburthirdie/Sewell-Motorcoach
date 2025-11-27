const { datasets, persist } = require('./state');
const { sanitizePayloadStrings } = require('./shared');
const { matchesTenant } = require('./tenantService');

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

module.exports = {
  getForTenant,
  update,
  getBadgeRules,
  updateBadgeRules
};
