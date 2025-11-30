const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { escapeOutputPayload } = require('./shared');
const { normalizeTenantId, matchesTenant } = require('./tenantService');

function safe(value) {
  return escapeOutputPayload(value);
}

function ensureShape() {
  datasets.aiLogs = datasets.aiLogs || [];
}

function log(entry = {}, tenantId) {
  ensureShape();
  const record = {
    id: randomUUID(),
    tenantId: normalizeTenantId(tenantId || entry.tenantId),
    type: entry.type || 'ai_event',
    evalId: entry.evalId,
    agentId: entry.agentId,
    sessionId: entry.sessionId,
    mode: entry.mode,
    user: entry.user,
    message: entry.message,
    internalTrace: entry.internalTrace,
    commands: entry.commands,
    tools: entry.tools,
    context: entry.context,
    provider: entry.provider,
    providerRequest: entry.providerRequest && {
      provider: entry.providerRequest.provider,
      type: entry.providerRequest.type,
      url: entry.providerRequest.url
    },
    modelConfig: entry.modelConfig,
    planSummary: entry.planSummary,
    userFacingMessage: entry.userFacingMessage,
    toolCalls: entry.toolCalls,
    success: entry.success ?? true,
    error: entry.error,
    createdAt: new Date().toISOString()
  };
  datasets.aiLogs.push(record);
  persist.aiLogs(datasets.aiLogs);
  return safe(record);
}

function list(filter = {}, tenantId) {
  ensureShape();
  const tenant = normalizeTenantId(tenantId || filter.tenantId);
  return datasets.aiLogs
    .filter(entry => matchesTenant(entry.tenantId, tenant))
    .filter(entry => (filter.type ? entry.type === filter.type : true))
    .map(safe);
}

function getById(id, tenantId) {
  ensureShape();
  const tenant = normalizeTenantId(tenantId);
  const found = datasets.aiLogs.find(entry => matchesTenant(entry.tenantId, tenant) && entry.id === id);
  return found ? safe(found) : null;
}

module.exports = {
  ensureShape,
  log,
  list,
  getById
};
