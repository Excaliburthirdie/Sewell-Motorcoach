const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { matchesTenant, normalizeTenantId } = require('./tenantService');
const { computeInventoryBadges } = require('./inventoryBadges');

const TRACKED_FIELDS = ['salesStory', 'spotlights', 'mediaHotspots'];

function addRevision(inventoryId, field, previousValue, tenantId, changedBy) {
  if (!TRACKED_FIELDS.includes(field)) return;
  const normalizedTenant = normalizeTenantId(tenantId);
  const revision = {
    id: randomUUID(),
    inventoryId,
    tenantId: normalizedTenant,
    field,
    previousValue: previousValue === undefined ? null : previousValue,
    changedBy: changedBy || 'system',
    changedAt: new Date().toISOString()
  };
  datasets.inventoryRevisions.push(revision);
  persist.inventoryRevisions(datasets.inventoryRevisions);
  return revision;
}

function listRevisions(inventoryId, tenantId) {
  const normalizedTenant = normalizeTenantId(tenantId);
  return datasets.inventoryRevisions
    .filter(rev => rev.inventoryId === inventoryId && matchesTenant(rev.tenantId, normalizedTenant))
    .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime());
}

function restoreRevision(inventoryId, revisionId, tenantId) {
  const normalizedTenant = normalizeTenantId(tenantId);
  const revision = datasets.inventoryRevisions.find(
    rev => rev.id === revisionId && rev.inventoryId === inventoryId && matchesTenant(rev.tenantId, normalizedTenant)
  );
  if (!revision) {
    return { notFound: true };
  }
  const index = datasets.inventory.findIndex(
    unit => unit.id === inventoryId && matchesTenant(unit.tenantId, normalizedTenant)
  );
  if (index === -1) {
    return { notFound: true };
  }
  const updated = { ...datasets.inventory[index], [revision.field]: revision.previousValue };
  updated.badges = computeInventoryBadges(updated, normalizedTenant);
  datasets.inventory[index] = updated;
  persist.inventory(datasets.inventory);
  return { unit: updated, revision };
}

module.exports = {
  addRevision,
  listRevisions,
  restoreRevision,
  TRACKED_FIELDS
};
