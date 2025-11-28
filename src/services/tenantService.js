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

function getHomeLocation(rawTenantId) {
  const tenantId = normalizeTenantId(rawTenantId);
  const tenant = datasets.tenants.find(entry => matchesTenant(entry.id, tenantId));
  const settings = (datasets.settings || []).find(entry => matchesTenant(entry.tenantId, tenantId));

  const lat = tenant?.lat ?? tenant?.latitude ?? settings?.locationLat ?? settings?.latitude;
  const lng = tenant?.lng ?? tenant?.longitude ?? settings?.locationLng ?? settings?.longitude;

  return {
    tenantId,
    name: tenant?.name || 'Primary Dealership',
    location: tenant?.location || settings?.city || '',
    coordinates:
      lat !== undefined && lng !== undefined
        ? { lat: Number(lat), lng: Number(lng) }
        : undefined
  };
}

module.exports = {
  DEFAULT_TENANT_ID,
  initializeTenants,
  resolveTenantId,
  getTenant,
  listTenants,
  scopedCollection,
  getHomeLocation,
  normalizeTenantId,
  matchesTenant,
  attachTenant
};
