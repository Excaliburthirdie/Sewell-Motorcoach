const { loadData, saveData } = require('../persistence/store');
const { DEFAULT_TENANT_ID, attachTenant, normalizeTenantId } = require('./tenancy');

const defaultSettings = {
  dealershipName: 'Sewell Motorcoach',
  address: '2118 Danville Rd',
  city: 'Harrodsburg',
  state: 'KY',
  zip: '40330',
  country: 'USA',
  currency: 'USD',
  phone: '859-734-5566',
  email: 'sales@sewellmotorcoach.com',
  hours: {
    weekday: '9:00 AM - 6:00 PM',
    saturday: '10:00 AM - 4:00 PM',
    sunday: 'Closed'
  }
};

const normalizeTenantedCollection = (collection = []) => collection.map(item => attachTenant(item));

const normalizeSettings = settingsData => {
  if (Array.isArray(settingsData)) {
    return settingsData.map(entry => attachTenant(entry));
  }
  return [attachTenant(settingsData || defaultSettings)];
};

const normalizeTenants = tenantsData => {
  const base = Array.isArray(tenantsData) ? tenantsData : [];
  const ensured = base.length
    ? base
    : [
        {
          id: DEFAULT_TENANT_ID,
          name: 'Sewell Motorcoach Harrodsburg',
          location: 'Harrodsburg, KY'
        }
      ];

  const normalized = ensured.map(tenant => ({
    id: normalizeTenantId(tenant.id),
    name: tenant.name || 'Primary Dealership',
    location: tenant.location || tenant.city || tenant.state || ''
  }));

  if (!normalized.find(t => t.id === DEFAULT_TENANT_ID)) {
    normalized.unshift({ id: DEFAULT_TENANT_ID, name: 'Primary Dealership', location: '' });
  }
  return normalized;
};

const datasets = {
  tenants: normalizeTenants(loadData('tenants.json', [])),
  inventory: normalizeTenantedCollection(loadData('inventory.json', [])),
  teams: normalizeTenantedCollection(loadData('teams.json', [])),
  reviews: normalizeTenantedCollection(loadData('reviews.json', [])),
  leads: normalizeTenantedCollection(loadData('leads.json', [])),
  contentPages: normalizeTenantedCollection(loadData('contentPages.json', [])),
  events: normalizeTenantedCollection(loadData('events.json', [])),
  capabilities: loadData('capabilities.json', []),
  settings: normalizeSettings(loadData('settings.json', defaultSettings)),
  customers: normalizeTenantedCollection(loadData('customers.json', [])),
  serviceTickets: normalizeTenantedCollection(loadData('serviceTickets.json', [])),
  financeOffers: normalizeTenantedCollection(loadData('financeOffers.json', [])),
  users: normalizeTenantedCollection(loadData('users.json', [])),
  refreshTokens: normalizeTenantedCollection(loadData('refreshTokens.json', [])),
  revokedRefreshTokens: normalizeTenantedCollection(loadData('revokedRefreshTokens.json', [])),
  seoProfiles: normalizeTenantedCollection(loadData('seoProfiles.json', [])),
  analytics: loadData('analytics.json', { events: [] }),
  pageLayouts: normalizeTenantedCollection(loadData('pageLayouts.json', [])),
  aiControl: loadData('aiControl.json', { providers: [], agents: [], observations: [], webFetches: [] })
};

const persist = {
  inventory: data => saveData('inventory.json', data),
  teams: data => saveData('teams.json', data),
  reviews: data => saveData('reviews.json', data),
  leads: data => saveData('leads.json', data),
  contentPages: data => saveData('contentPages.json', data),
  events: data => saveData('events.json', data),
  capabilities: data => saveData('capabilities.json', data),
  settings: data => saveData('settings.json', data),
  customers: data => saveData('customers.json', data),
  serviceTickets: data => saveData('serviceTickets.json', data),
  financeOffers: data => saveData('financeOffers.json', data),
  users: data => saveData('users.json', data),
  refreshTokens: data => saveData('refreshTokens.json', data),
  revokedRefreshTokens: data => saveData('revokedRefreshTokens.json', data),
  tenants: data => saveData('tenants.json', data),
  seoProfiles: data => saveData('seoProfiles.json', data),
  analytics: data => saveData('analytics.json', data),
  pageLayouts: data => saveData('pageLayouts.json', data),
  aiControl: data => saveData('aiControl.json', data)
};

module.exports = {
  datasets,
  persist
};
