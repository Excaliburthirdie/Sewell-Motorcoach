const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { escapeOutputPayload, sanitizePayloadStrings, validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');

function safe(layout) {
  return escapeOutputPayload(layout);
}

function getByPage(pageId, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const layout = datasets.pageLayouts.find(entry => entry.pageId === pageId && matchesTenant(entry.tenantId, tenant));
  return layout ? safe(layout) : undefined;
}

function list(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  return datasets.pageLayouts.filter(entry => matchesTenant(entry.tenantId, tenant)).map(safe);
}

function saveDraft(pageId, payload, tenantId) {
  const requiredError = validateFields({ pageId, ...payload }, ['pageId']);
  if (requiredError) {
    return { error: requiredError };
  }

  const sanitized = sanitizePayloadStrings(payload, ['title', 'theme', 'note']);
  const existingIndex = datasets.pageLayouts.findIndex(
    entry => entry.pageId === pageId && matchesTenant(entry.tenantId, tenantId)
  );

  const base = existingIndex >= 0 ? datasets.pageLayouts[existingIndex] : { id: randomUUID(), version: 0 };
  const nextVersion = (base.version || 0) + 1;

  const layout = attachTenant(
    {
      ...base,
      pageId,
      title: sanitized.title || base.title || 'Page Layout',
      theme: sanitized.theme || base.theme || 'default',
      blocks: Array.isArray(payload.blocks) ? payload.blocks : base.blocks || [],
      widgets: Array.isArray(payload.widgets) ? payload.widgets : base.widgets || [],
      status: 'draft',
      version: nextVersion,
      note: sanitized.note || 'Updated layout',
      updatedAt: new Date().toISOString(),
      createdAt: base.createdAt || new Date().toISOString()
    },
    tenantId
  );

  if (existingIndex >= 0) {
    datasets.pageLayouts[existingIndex] = layout;
  } else {
    datasets.pageLayouts.push(layout);
  }
  persist.pageLayouts(datasets.pageLayouts);
  return { layout: safe(layout) };
}

function publish(pageId, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const index = datasets.pageLayouts.findIndex(
    entry => entry.pageId === pageId && matchesTenant(entry.tenantId, tenant)
  );
  if (index === -1) {
    return { notFound: true };
  }
  const updated = {
    ...datasets.pageLayouts[index],
    status: 'published',
    publishedAt: new Date().toISOString()
  };
  datasets.pageLayouts[index] = updated;
  persist.pageLayouts(datasets.pageLayouts);
  return { layout: safe(updated) };
}

module.exports = {
  getByPage,
  list,
  saveDraft,
  publish
};
