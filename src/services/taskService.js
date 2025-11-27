const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');
const { escapeOutputPayload, sanitizePayloadStrings, validateFields } = require('./shared');

const VALID_TASK_STATUSES = ['open', 'in_progress', 'completed', 'canceled'];

function safe(task) {
  return escapeOutputPayload(task);
}

function normalizeDate(value) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function create(payload, tenantId) {
  const requiredError = validateFields(payload, ['title']);
  if (requiredError) {
    return { error: requiredError };
  }
  const sanitized = sanitizePayloadStrings(payload, ['title', 'notes', 'assignedTo', 'contactId', 'status']);
  const status = VALID_TASK_STATUSES.includes(sanitized.status) ? sanitized.status : 'open';
  const task = attachTenant(
    {
      id: randomUUID(),
      title: sanitized.title,
      notes: sanitized.notes,
      contactId: sanitized.contactId,
      status,
      assignedTo: sanitized.assignedTo,
      dueAt: normalizeDate(payload.dueAt),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    tenantId
  );
  datasets.tasks.push(task);
  persist.tasks(datasets.tasks);
  return { task: safe(task) };
}

function update(id, payload, tenantId) {
  const idx = datasets.tasks.findIndex(entry => entry.id === id && matchesTenant(entry.tenantId, tenantId));
  if (idx === -1) return { notFound: true };
  const sanitized = sanitizePayloadStrings(payload, ['title', 'notes', 'assignedTo', 'contactId', 'status']);
  const status = VALID_TASK_STATUSES.includes(sanitized.status)
    ? sanitized.status
    : datasets.tasks[idx].status;
  datasets.tasks[idx] = {
    ...datasets.tasks[idx],
    ...sanitized,
    status,
    dueAt: normalizeDate(payload.dueAt) || datasets.tasks[idx].dueAt,
    updatedAt: new Date().toISOString()
  };
  persist.tasks(datasets.tasks);
  return { task: safe(datasets.tasks[idx]) };
}

function list(query = {}, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const { status, assignedTo, contactId, dueFrom, dueTo } = query;
  return datasets.tasks
    .filter(task => matchesTenant(task.tenantId, tenant))
    .filter(task => (status ? task.status === status : true))
    .filter(task => (assignedTo ? task.assignedTo === assignedTo : true))
    .filter(task => (contactId ? task.contactId === contactId : true))
    .filter(task => {
      if (!task.dueAt) return true;
      const due = new Date(task.dueAt).getTime();
      const fromOk = dueFrom ? due >= new Date(dueFrom).getTime() : true;
      const toOk = dueTo ? due <= new Date(dueTo).getTime() : true;
      return fromOk && toOk;
    })
    .map(safe);
}

module.exports = { VALID_TASK_STATUSES, create, update, list };
