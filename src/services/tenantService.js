const { datasets, persist } = require('./state');
const { DEFAULT_TENANT_ID, attachTenant, filterByTenant, matchesTenant, normalizeTenantId } = require('./tenancy');

function initializeTenants() {
  // Ensure at least the default tenant exists
  if (!datasets.tenants.find(t => matchesTenant(t.id, DEFAULT_TENANT_ID))) {
    datasets.tenants.push({ id: DEFAULT_TENANT_ID, name: 'Primary Dealership', location: '' });
  }

  persist.tenants(datasets.tenants);

  // Normalize tenant IDs across persisted datasets for safer filtering
  ['inventory', 'teams', 'reviews', 'leads', 'customers', 'serviceTickets', 'financeOffers', 'users', 'refreshTokens'].forEach(
    key => {
      datasets[key] = (datasets[key] || []).map(entry => attachTenant(entry));
      persist[key](datasets[key]);
    }
  );

  datasets.settings = (datasets.settings || []).map(entry => attachTenant(entry));
  persist.settings(datasets.settings);
}

function resolveTenantId(rawTenantId) {
  const normalized = normalizeTenantId(rawTenantId);
  return datasets.tenants.find(t => matchesTenant(t.id, normalized)) ? normalized : null;
}

function getTenant(rawTenantId) {
  const normalized = normalizeTenantId(rawTenantId);
  return datasets.tenants.find(t => matchesTenant(t.id, normalized)) || null;
}

function listTenants() {
  return datasets.tenants;
}

function scopedCollection(collection, tenantId) {
  return filterByTenant(collection, tenantId);
}

module.exports = {
  DEFAULT_TENANT_ID,
  initializeTenants,
  resolveTenantId,
  getTenant,
  listTenants,
  scopedCollection,
  normalizeTenantId,
  matchesTenant,
  attachTenant
};
