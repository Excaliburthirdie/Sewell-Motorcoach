const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');
const { escapeOutputPayload, sanitizePayloadStrings, validateFields } = require('./shared');

const SUPPORTED_EVENT_TYPES = ['search', 'view', 'lead_submit'];

function safeEvent(event) {
  return escapeOutputPayload(event);
}

function create(payload, tenantId) {
  const requiredError = validateFields(payload, ['type']);
  if (requiredError) {
    return { error: requiredError };
  }
  const type = payload.type.toLowerCase();
  if (!SUPPORTED_EVENT_TYPES.includes(type)) {
    return { error: `Unsupported event type: ${payload.type}` };
  }
  const sanitized = sanitizePayloadStrings(payload, ['type', 'stockNumber', 'leadId', 'query', 'referrer']);
  const event = attachTenant(
    {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      type,
      stockNumber: sanitized.stockNumber || null,
      leadId: sanitized.leadId || null,
      query: sanitized.query || null,
      referrer: sanitized.referrer || null
    },
    tenantId
  );

  datasets.events.push(event);
  persist.events(datasets.events);
  return { event: safeEvent(event) };
}

function list(query = {}, tenantId) {
  const { type } = query;
  const tenant = normalizeTenantId(tenantId);
  return datasets.events
    .filter(event => matchesTenant(event.tenantId, tenant))
    .filter(event => (type ? event.type === type : true))
    .map(safeEvent);
}

function dailyRollup(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const events = datasets.events.filter(event => matchesTenant(event.tenantId, tenant));
  const leads = datasets.leads.filter(lead => matchesTenant(lead.tenantId, tenant));

  const eventDaily = events.reduce((acc, event) => {
    const day = event.createdAt?.slice(0, 10) || 'unknown';
    acc[day] = acc[day] || { total: 0 };
    acc[day].total += 1;
    acc[day][event.type] = (acc[day][event.type] || 0) + 1;
    return acc;
  }, {});

  const leadDaily = leads.reduce((acc, lead) => {
    const day = lead.createdAt?.slice(0, 10) || 'unknown';
    acc[day] = acc[day] || { total: 0 };
    acc[day].total += 1;
    acc[day][lead.status] = (acc[day][lead.status] || 0) + 1;
    return acc;
  }, {});

  return { events: eventDaily, leads: leadDaily };
}

module.exports = {
  SUPPORTED_EVENT_TYPES,
  create,
  list,
  dailyRollup
};
