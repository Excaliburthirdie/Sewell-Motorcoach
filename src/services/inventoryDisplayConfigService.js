const { escapeOutputPayload, sanitizePayloadStrings } = require('./shared');
const { datasets, persist } = require('./state');
const { normalizeTenantId, matchesTenant } = require('./tenantService');

function ensureShape() {
  datasets.inventoryDisplayConfigs = datasets.inventoryDisplayConfigs || [];
}

function defaultConfig(tenantId) {
  return {
    tenantId: normalizeTenantId(tenantId),
    listView: {
      viewMode: 'hero',
      fields: [
        { field: 'heroImage', visible: true, order: 1 },
        { field: 'year', visible: true, order: 2 },
        { field: 'make', visible: true, order: 3 },
        { field: 'model', visible: true, order: 4 },
        { field: 'price', visible: true, order: 5 },
        { field: 'mileage', visible: false, order: 6 }
      ],
      defaultSort: { field: 'featuredRank', direction: 'desc' }
    },
    detailView: {
      fields: [
        { field: 'summary', visible: true, order: 1 },
        { field: 'specs', visible: true, order: 2 },
        { field: 'media', visible: true, order: 3 }
      ]
    },
    updatedAt: new Date().toISOString()
  };
}

function get(tenantId) {
  ensureShape();
  const tenant = normalizeTenantId(tenantId);
  const existing = datasets.inventoryDisplayConfigs.find(entry => matchesTenant(entry.tenantId, tenant));
  return escapeOutputPayload(existing || defaultConfig(tenant));
}

function update(payload, tenantId) {
  ensureShape();
  const tenant = normalizeTenantId(tenantId);
  const sanitized = sanitizePayloadStrings(payload, ['viewMode', 'field', 'direction']);
  const currentIndex = datasets.inventoryDisplayConfigs.findIndex(entry => matchesTenant(entry.tenantId, tenant));
  const base = currentIndex >= 0 ? datasets.inventoryDisplayConfigs[currentIndex] : defaultConfig(tenant);
  const merged = {
    ...base,
    ...sanitized,
    listView: { ...base.listView, ...(sanitized.listView || {}) },
    detailView: { ...base.detailView, ...(sanitized.detailView || {}) }
  };
  const next = { ...merged, tenantId: tenant, updatedAt: new Date().toISOString() };
  if (currentIndex >= 0) {
    datasets.inventoryDisplayConfigs[currentIndex] = next;
  } else {
    datasets.inventoryDisplayConfigs.push(next);
  }
  persist.inventoryDisplayConfigs(datasets.inventoryDisplayConfigs);
  return escapeOutputPayload(next);
}

module.exports = {
  get,
  update,
  defaultConfig,
  ensureShape
};
