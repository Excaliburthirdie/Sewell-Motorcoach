const { v4: uuidv4 } = require('uuid');
const { datasets, persist } = require('./state');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');

function schedule(payload, tenantId) {
  const ticket = attachTenant(
    {
      id: uuidv4(),
      type: payload.type || 'pdi',
      inventoryId: payload.inventoryId,
      customerId: payload.customerId,
      preferredDate: payload.preferredDate,
      status: 'scheduled',
      notes: payload.notes || '',
      createdAt: new Date().toISOString(),
      warranty: Boolean(payload.warranty)
    },
    tenantId
  );
  datasets.serviceTickets.push(ticket);
  persist.serviceTickets(datasets.serviceTickets);
  return ticket;
}

function list(query = {}, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  return datasets.serviceTickets.filter(ticket => matchesTenant(ticket.tenantId, tenant)).filter(ticket =>
    query.type ? ticket.type === query.type : true
  );
}

module.exports = { schedule, list };
