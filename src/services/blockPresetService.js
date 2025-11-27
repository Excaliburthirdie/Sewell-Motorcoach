const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { escapeOutputPayload, sanitizePayloadStrings, validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');

function safe(preset) {
  return escapeOutputPayload(preset);
}

function list(query = {}, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const { type } = query;
  return datasets.blockPresets
    .filter(preset => matchesTenant(preset.tenantId, tenant))
    .filter(preset => (type ? preset.type === type : true))
    .map(safe);
}

function create(payload, tenantId, actor) {
  const requiredError = validateFields(payload, ['type', 'label']);
  if (requiredError) {
    return { error: requiredError };
  }
  const sanitized = sanitizePayloadStrings(payload, ['type', 'label', 'createdBy']);
  const preset = attachTenant(
    {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: actor || sanitized.createdBy,
      ...sanitized,
      props: payload.props || {}
    },
    tenantId
  );
  datasets.blockPresets.push(preset);
  persist.blockPresets(datasets.blockPresets);
  return { preset: safe(preset) };
}

function update(id, payload, tenantId, actor) {
  const index = datasets.blockPresets.findIndex(preset => preset.id === id && matchesTenant(preset.tenantId, tenantId));
  if (index === -1) return { notFound: true };
  const sanitized = sanitizePayloadStrings(payload, ['type', 'label', 'createdBy']);
  const updated = {
    ...datasets.blockPresets[index],
    ...sanitized,
    props: payload.props !== undefined ? payload.props : datasets.blockPresets[index].props,
    updatedAt: new Date().toISOString(),
    updatedBy: actor || payload.updatedBy || datasets.blockPresets[index].updatedBy
  };
  datasets.blockPresets[index] = updated;
  persist.blockPresets(datasets.blockPresets);
  return { preset: safe(updated) };
}

function remove(id, tenantId) {
  const index = datasets.blockPresets.findIndex(preset => preset.id === id && matchesTenant(preset.tenantId, tenantId));
  if (index === -1) return { notFound: true };
  datasets.blockPresets.splice(index, 1);
  persist.blockPresets(datasets.blockPresets);
  return { success: true };
}

module.exports = {
  list,
  create,
  update,
  remove
};
