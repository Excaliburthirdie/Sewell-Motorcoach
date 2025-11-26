const { datasets, persist } = require('./state');
const { validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId, DEFAULT_TENANT_ID } = require('./tenantService');

function get(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  return (
    datasets.settings.find(entry => matchesTenant(entry.tenantId, tenant)) ||
    datasets.settings.find(entry => matchesTenant(entry.tenantId, DEFAULT_TENANT_ID))
  );
}

function update(payload, tenantId) {

function get() {
  return datasets.settings;
}

function update(payload) {
  const requiredError = validateFields(payload, ['dealershipName', 'phone']);
  if (requiredError) {
    return { error: requiredError };
  }

  const tenant = normalizeTenantId(tenantId);
  const index = datasets.settings.findIndex(entry => matchesTenant(entry.tenantId, tenant));
  const base = index === -1 ? attachTenant({}, tenant) : datasets.settings[index];
  const hours = payload.hours || base.hours || {};

  const merged = {
    ...base,
    ...payload,
    hours: {
      ...base.hours,
      ...hours
    }
  };

  if (index === -1) {
    datasets.settings.push(merged);
  } else {
    datasets.settings[index] = merged;
  }

  persist.settings(datasets.settings);
  return { settings: merged };
  const hours = payload.hours || datasets.settings.hours;
  datasets.settings = {
    ...datasets.settings,
    ...payload,
    hours: {
      ...datasets.settings.hours,
      ...hours
    }
  };
  persist.settings(datasets.settings);
  return { settings: datasets.settings };
}

module.exports = {
  get,
  update
};
