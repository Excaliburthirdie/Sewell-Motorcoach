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

module.exports = {
  getForTenant,
  update
};
