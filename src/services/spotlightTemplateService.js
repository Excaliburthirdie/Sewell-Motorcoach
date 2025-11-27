const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { normalizeTenantId, matchesTenant } = require('./tenantService');
const { sanitizeString } = require('./shared');
const { computeInventoryBadges } = require('./inventoryBadges');

function normalizeSpotlights(spotlights = []) {
  if (!Array.isArray(spotlights)) return [];
  return spotlights.map(entry => ({
    id: entry.id || randomUUID(),
    title: sanitizeString(entry.title),
    description: sanitizeString(entry.description),
    valueTag: sanitizeString(entry.valueTag),
    priority: Number(entry.priority) || 0
  }));
}

function list(tenantId) {
  const normalizedTenant = normalizeTenantId(tenantId);
  return datasets.spotlightTemplates.filter(template => matchesTenant(template.tenantId, normalizedTenant));
}

function create(payload, tenantId, createdBy) {
  const template = {
    id: randomUUID(),
    tenantId: normalizeTenantId(tenantId),
    name: sanitizeString(payload.name),
    description: sanitizeString(payload.description),
    spotlights: normalizeSpotlights(payload.spotlights),
    createdBy: createdBy || 'system',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  datasets.spotlightTemplates.push(template);
  persist.spotlightTemplates(datasets.spotlightTemplates);
  return { template };
}

function update(id, payload, tenantId) {
  const index = datasets.spotlightTemplates.findIndex(
    template => template.id === id && matchesTenant(template.tenantId, tenantId)
  );
  if (index === -1) return { notFound: true };
  const updated = {
    ...datasets.spotlightTemplates[index],
    name: payload.name ? sanitizeString(payload.name) : datasets.spotlightTemplates[index].name,
    description:
      payload.description !== undefined
        ? sanitizeString(payload.description)
        : datasets.spotlightTemplates[index].description,
    spotlights:
      payload.spotlights !== undefined
        ? normalizeSpotlights(payload.spotlights)
        : datasets.spotlightTemplates[index].spotlights,
    updatedAt: new Date().toISOString()
  };
  datasets.spotlightTemplates[index] = updated;
  persist.spotlightTemplates(datasets.spotlightTemplates);
  return { template: updated };
}

function remove(id, tenantId) {
  const index = datasets.spotlightTemplates.findIndex(
    template => template.id === id && matchesTenant(template.tenantId, tenantId)
  );
  if (index === -1) return { notFound: true };
  datasets.spotlightTemplates.splice(index, 1);
  persist.spotlightTemplates(datasets.spotlightTemplates);
  return { removed: true };
}

function applyTemplate(templateId, inventoryIds = [], tenantId) {
  const template = datasets.spotlightTemplates.find(
    entry => entry.id === templateId && matchesTenant(entry.tenantId, tenantId)
  );
  if (!template) return { notFound: true };
  const applied = [];
  const updatedInventory = datasets.inventory.map(unit => {
    if (!inventoryIds.includes(unit.id) || !matchesTenant(unit.tenantId, tenantId)) return unit;
    const next = { ...unit, spotlights: normalizeSpotlights(template.spotlights) };
    next.badges = computeInventoryBadges(next, tenantId);
    applied.push(next.id);
    return next;
  });
  datasets.inventory = updatedInventory;
  persist.inventory(datasets.inventory);
  return { applied, template };
}

module.exports = {
  list,
  create,
  update,
  remove,
  applyTemplate
};
