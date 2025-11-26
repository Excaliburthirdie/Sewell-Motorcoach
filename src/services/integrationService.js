const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { datasets, persist } = require('./state');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');

function listIntegrations(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  return datasets.integrations.filter(entry => matchesTenant(entry.tenantId, tenant));
}

function recordDmsSync(payload, tenantId) {
  const record = attachTenant(
    {
      id: uuidv4(),
      type: 'dms',
      status: payload.status || 'pending',
      name: payload.name || 'DMS Sync',
      url: payload.url || config.integrations.dmsEndpoint,
      lastSyncAt: new Date().toISOString(),
      details: payload.details || {}
    },
    tenantId
  );
  datasets.integrations.push(record);
  persist.integrations(datasets.integrations);
  return record;
}

function recordOemFeed(payload, tenantId) {
  const record = attachTenant(
    {
      id: uuidv4(),
      type: 'oem',
      name: payload.name || 'OEM Feed',
      status: payload.status || 'active',
      url: payload.url || config.integrations.oemFeedBase,
      lastSyncAt: new Date().toISOString(),
      details: payload.details || {}
    },
    tenantId
  );
  datasets.integrations.push(record);
  persist.integrations(datasets.integrations);
  return record;
}

function queueMarketplaceEvent(payload, tenantId) {
  const record = attachTenant(
    {
      id: uuidv4(),
      marketplace: payload.marketplace || 'rv-trader',
      inventoryId: payload.inventoryId,
      type: payload.type || 'availability-sync',
      payload: payload.payload || {},
      status: payload.status || 'queued',
      createdAt: new Date().toISOString()
    },
    tenantId
  );
  datasets.marketplaceEvents.push(record);
  persist.marketplaceEvents(datasets.marketplaceEvents);
  return record;
}

function completeMarketplaceEvent(id, status, tenantId) {
  const index = datasets.marketplaceEvents.findIndex(evt => evt.id === id && matchesTenant(evt.tenantId, tenantId));
  if (index === -1) return { notFound: true };
  datasets.marketplaceEvents[index] = { ...datasets.marketplaceEvents[index], status };
  persist.marketplaceEvents(datasets.marketplaceEvents);
  return { event: datasets.marketplaceEvents[index] };
}

module.exports = {
  listIntegrations,
  recordDmsSync,
  recordOemFeed,
  queueMarketplaceEvent,
  completeMarketplaceEvent
};
