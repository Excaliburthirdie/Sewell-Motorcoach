const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');
const { escapeOutputPayload, sanitizePayloadStrings, validateFields } = require('./shared');

const VALID_NOTIFICATION_STATUSES = ['pending', 'sent', 'dismissed'];

function safe(notification) {
  return escapeOutputPayload(notification);
}

function create(payload, tenantId) {
  const requiredError = validateFields(payload, ['type', 'message']);
  if (requiredError) {
    return { error: requiredError };
  }
  const sanitized = sanitizePayloadStrings(payload, ['type', 'message', 'contactId', 'unitId']);
  const channels = Array.isArray(payload.channelPreferences)
    ? payload.channelPreferences.filter(Boolean)
    : [];
  const notification = attachTenant(
    {
      id: randomUUID(),
      type: sanitized.type,
      message: sanitized.message,
      contactId: sanitized.contactId,
      unitId: sanitized.unitId,
      channelPreferences: channels,
      status: VALID_NOTIFICATION_STATUSES.includes(payload.status) ? payload.status : 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    tenantId
  );
  datasets.notifications.push(notification);
  persist.notifications(datasets.notifications);
  return { notification: safe(notification) };
}

function list(query = {}, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const { status, contactId } = query;
  return datasets.notifications
    .filter(entry => matchesTenant(entry.tenantId, tenant))
    .filter(entry => (status ? entry.status === status : true))
    .filter(entry => (contactId ? entry.contactId === contactId : true))
    .map(safe);
}

function updateStatus(id, status, tenantId) {
  const idx = datasets.notifications.findIndex(entry => entry.id === id && matchesTenant(entry.tenantId, tenantId));
  if (idx === -1) return { notFound: true };
  if (!VALID_NOTIFICATION_STATUSES.includes(status)) {
    return { error: `Status must be one of: ${VALID_NOTIFICATION_STATUSES.join(', ')}` };
  }
  datasets.notifications[idx] = {
    ...datasets.notifications[idx],
    status,
    updatedAt: new Date().toISOString()
  };
  persist.notifications(datasets.notifications);
  return { notification: safe(datasets.notifications[idx]) };
}

module.exports = { VALID_NOTIFICATION_STATUSES, create, list, updateStatus };
