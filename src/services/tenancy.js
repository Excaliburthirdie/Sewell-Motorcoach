const config = require('../config');

const DEFAULT_TENANT_ID = config.tenancy.defaultTenantId;

function normalizeTenantId(tenantId) {
  return (tenantId || DEFAULT_TENANT_ID).toString();
}

function matchesTenant(recordTenantId, tenantId) {
  return normalizeTenantId(recordTenantId) === normalizeTenantId(tenantId);
}

function attachTenant(record, tenantId) {
  return { ...record, tenantId: normalizeTenantId(record.tenantId || tenantId) };
}

function filterByTenant(collection, tenantId) {
  const normalizedTenant = normalizeTenantId(tenantId);
  return collection.filter(item => matchesTenant(item.tenantId, normalizedTenant));
}

module.exports = {
  DEFAULT_TENANT_ID,
  normalizeTenantId,
  matchesTenant,
  attachTenant,
  filterByTenant
};
