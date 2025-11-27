const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');
const { sanitizePayloadStrings, validateFields, escapeOutputPayload, sanitizeBoolean } = require('./shared');

const VALID_TICKET_STATUSES = ['open', 'in_progress', 'on_hold', 'closed'];
const ALLOWED_TRANSITIONS = {
  open: ['in_progress', 'on_hold', 'closed'],
  in_progress: ['on_hold', 'closed'],
  on_hold: ['in_progress', 'closed'],
  closed: []
};

function sanitizeLineItems(lineItems = []) {
  if (!Array.isArray(lineItems)) return [];
  return lineItems
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      description: sanitizePayloadStrings(item, ['description']).description,
      laborHours: Number(item.laborHours) || 0,
      partsCost: Number(item.partsCost) || 0
    }));
}

function safeTicket(ticket) {
  return escapeOutputPayload(ticket);
}

function list(query = {}, tenantId) {
  const { status, customerId } = query;
  const limit = Math.max(0, Number(query.limit ?? 50));
  const offset = Math.max(0, Number(query.offset ?? 0));
  const tenant = normalizeTenantId(tenantId);
  const filtered = datasets.serviceTickets
    .filter(ticket => matchesTenant(ticket.tenantId, tenant))
    .filter(ticket => (status ? ticket.status === status : true))
    .filter(ticket => (customerId ? ticket.customerId === customerId : true));

  const items = filtered.slice(offset, offset + limit).map(safeTicket);
  return { items, total: filtered.length, limit, offset };
}

function findById(id, tenantId) {
  const ticket = datasets.serviceTickets.find(entry => entry.id === id && matchesTenant(entry.tenantId, tenantId));
  return ticket ? safeTicket(ticket) : undefined;
}

function create(payload, tenantId) {
  const requiredError = validateFields(payload, ['customerId', 'concern']);
  if (requiredError) {
    return { error: requiredError };
  }

  const body = sanitizePayloadStrings(payload, ['customerId', 'unitId', 'concern', 'technician']);
  const status = VALID_TICKET_STATUSES.includes(body.status) ? body.status : 'open';
  const ticket = attachTenant(
    {
      id: randomUUID(),
      status,
      createdAt: new Date().toISOString(),
      scheduledDate: payload.scheduledDate ? new Date(payload.scheduledDate).toISOString() : undefined,
      warranty: sanitizeBoolean(payload.warranty, false),
      lineItems: sanitizeLineItems(payload.lineItems),
      ...body
    },
    tenantId
  );
  datasets.serviceTickets.push(ticket);
  persist.serviceTickets(datasets.serviceTickets);
  return { ticket: safeTicket(ticket) };
}

function update(id, payload, tenantId) {
  const index = datasets.serviceTickets.findIndex(entry => entry.id === id && matchesTenant(entry.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }

  const current = datasets.serviceTickets[index];
  const body = sanitizePayloadStrings(payload, ['customerId', 'unitId', 'concern', 'technician']);
  const nextStatus = body.status && VALID_TICKET_STATUSES.includes(body.status) ? body.status : current.status;
  if (!ALLOWED_TRANSITIONS[current.status].includes(nextStatus) && current.status !== nextStatus) {
    return { error: `Invalid status transition from ${current.status} to ${nextStatus}` };
  }

  datasets.serviceTickets[index] = {
    ...current,
    ...body,
    status: nextStatus,
    warranty: payload.warranty === undefined ? current.warranty : sanitizeBoolean(payload.warranty, false),
    scheduledDate: payload.scheduledDate
      ? new Date(payload.scheduledDate).toISOString()
      : current.scheduledDate,
    lineItems: payload.lineItems ? sanitizeLineItems(payload.lineItems) : current.lineItems
  };
  persist.serviceTickets(datasets.serviceTickets);
  return { ticket: safeTicket(datasets.serviceTickets[index]) };
}

function remove(id, tenantId) {
  const index = datasets.serviceTickets.findIndex(entry => entry.id === id && matchesTenant(entry.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const [removed] = datasets.serviceTickets.splice(index, 1);
  persist.serviceTickets(datasets.serviceTickets);
  return { ticket: safeTicket(removed) };
}

module.exports = {
  VALID_TICKET_STATUSES,
  list,
  findById,
  create,
  update,
  remove
};
