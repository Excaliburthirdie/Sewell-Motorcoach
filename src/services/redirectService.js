const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { escapeOutputPayload, sanitizePayloadStrings, validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');

function safe(redirect) {
  return escapeOutputPayload(redirect);
}

function list(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  return datasets.redirects.filter(entry => matchesTenant(entry.tenantId, tenant)).map(safe);
}

function create(payload, tenantId) {
  const requiredError = validateFields(payload, ['sourcePath', 'targetPath']);
  if (requiredError) return { error: requiredError };

  const sanitized = sanitizePayloadStrings(payload, ['sourcePath', 'targetPath', 'createdBy']);
  const tenant = normalizeTenantId(tenantId);
  const alreadyExists = datasets.redirects.find(
    entry => matchesTenant(entry.tenantId, tenant) && entry.sourcePath === sanitized.sourcePath
  );
  if (alreadyExists) {
    return { error: 'Redirect for sourcePath already exists' };
  }

  const redirect = attachTenant(
    {
      id: randomUUID(),
      sourcePath: sanitized.sourcePath,
      targetPath: sanitized.targetPath,
      statusCode: sanitized.statusCode === 302 || sanitized.statusCode === '302' ? 302 : 301,
      createdBy: sanitized.createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    tenant
  );

  datasets.redirects.push(redirect);
  persist.redirects(datasets.redirects);
  return { redirect: safe(redirect) };
}

function remove(id, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const idx = datasets.redirects.findIndex(entry => entry.id === id && matchesTenant(entry.tenantId, tenant));
  if (idx === -1) return { notFound: true };
  datasets.redirects.splice(idx, 1);
  persist.redirects(datasets.redirects);
  return { success: true };
}

module.exports = { list, create, remove };
