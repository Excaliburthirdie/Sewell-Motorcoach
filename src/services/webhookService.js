const { randomUUID, createHash } = require('node:crypto');
const { datasets, persist } = require('./state');
const { attachTenant } = require('./tenancy');

const ALLOWED_EVENTS = [
  'lead.created',
  'lead.updated',
  'inventory.created',
  'inventory.updated',
  'service-ticket.created',
  'finance-offer.updated',
  'customer.created'
];

function list(query = {}, tenantId) {
  const { eventType, active } = query;
  return datasets.webhooks.filter(webhook => {
    const tenantMatch = !tenantId || webhook.tenantId === tenantId;
    const eventMatch = !eventType || webhook.eventTypes.includes(eventType);
    const activeMatch = active === undefined ? true : webhook.active === active;
    return tenantMatch && eventMatch && activeMatch;
  });
}

function create(input, tenantId) {
  const now = new Date().toISOString();
  const secret = input.secret || createHash('sha256').update(`${now}-${randomUUID()}`).digest('hex');
  const webhook = attachTenant({
    id: randomUUID(),
    url: input.url,
    description: input.description || '',
    eventTypes: input.eventTypes?.length ? input.eventTypes : ALLOWED_EVENTS,
    secret,
    headers: input.headers || {},
    active: input.active !== false,
    createdAt: now,
    updatedAt: now
  }, tenantId);
  datasets.webhooks.push(webhook);
  persist.webhooks(datasets.webhooks);
  return { webhook };
}

function update(id, updates, tenantId) {
  const index = datasets.webhooks.findIndex(w => w.id === id && w.tenantId === tenantId);
  if (index === -1) return { notFound: true };
  const existing = datasets.webhooks[index];
  const next = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString()
  };
  datasets.webhooks[index] = next;
  persist.webhooks(datasets.webhooks);
  return { webhook: next };
}

function remove(id, tenantId) {
  const index = datasets.webhooks.findIndex(w => w.id === id && w.tenantId === tenantId);
  if (index === -1) return { notFound: true };
  const [removed] = datasets.webhooks.splice(index, 1);
  persist.webhooks(datasets.webhooks);
  return { webhook: removed };
}

function recordDelivery(eventType, webhookId, payload, status, tenantId, details = {}) {
  const delivery = attachTenant({
    id: randomUUID(),
    webhookId,
    eventType,
    payload,
    status,
    details,
    createdAt: new Date().toISOString()
  }, tenantId);
  datasets.webhookDeliveries.push(delivery);
  if (datasets.webhookDeliveries.length > 5000) {
    datasets.webhookDeliveries.splice(0, datasets.webhookDeliveries.length - 5000);
  }
  persist.webhookDeliveries(datasets.webhookDeliveries);
  return delivery;
}

function deliveries(query = {}, tenantId) {
  const { webhookId, eventType, limit = 50 } = query;
  const filtered = datasets.webhookDeliveries.filter(entry => {
    const tenantMatch = !tenantId || entry.tenantId === tenantId;
    const webhookMatch = !webhookId || entry.webhookId === webhookId;
    const eventMatch = !eventType || entry.eventType === eventType;
    return tenantMatch && webhookMatch && eventMatch;
  });
  return filtered.slice(-Number(limit)).reverse();
}

function trigger(eventType, payload, tenantId) {
  const targets = list({ eventType, active: true }, tenantId);
  if (!targets.length) return { deliveries: [] };
  const results = targets.map(target =>
    recordDelivery(eventType, target.id, payload, 'queued', tenantId, {
      note: 'Delivery queued for external system',
      callback: target.url
    })
  );
  return { deliveries: results };
}

module.exports = {
  ALLOWED_EVENTS,
  create,
  list,
  update,
  remove,
  deliveries,
  trigger,
  recordDelivery
};
