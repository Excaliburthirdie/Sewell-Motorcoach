const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const { datasets, persist } = require('./state');
const { DATA_DIR } = require('../persistence/store');
const { escapeOutputPayload, sanitizeBoolean, sanitizePayloadStrings, validateFields } = require('./shared');
const { maskSensitiveFields } = require('./security');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');

const VALID_LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];
const VALID_TRANSITIONS = {
  new: ['contacted', 'qualified', 'lost'],
  contacted: ['qualified', 'lost', 'won'],
  qualified: ['won', 'lost'],
  won: [],
  lost: []
};

function auditLeadChange(tenantId, leadId, actor, before, after) {
  const record = {
    timestamp: new Date().toISOString(),
    tenantId,
    entity: 'lead',
    id: leadId,
    actor,
    before: maskSensitiveFields(before),
    after: maskSensitiveFields(after)
  };
  fs.appendFile(`${DATA_DIR}/audit.log`, `${JSON.stringify(record)}\n`, () => {});
}

function safeLead(lead) {
  return escapeOutputPayload(lead);
}

function findById(id, tenantId) {
  const lead = datasets.leads.find(l => l.id === id && matchesTenant(l.tenantId, tenantId));
  return lead ? safeLead(lead) : undefined;
}

function create(payload, tenantId) {
  const requiredError = validateFields(payload, ['name', 'email', 'message']);
  if (requiredError) {
    return { error: requiredError };
  }

  const body = sanitizePayloadStrings(payload, [
    'name',
    'email',
    'message',
    'subject',
    'utmSource',
    'utmMedium',
    'utmCampaign',
    'utmTerm',
    'referrer',
    'assignedTo'
  ]);

  const lead = attachTenant(
    {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      status: VALID_LEAD_STATUSES.includes(body.status) ? body.status : 'new',
      subject: body.subject || 'General inquiry',
      assignedTo: body.assignedTo,
      dueDate: body.dueDate,
      lastContactedAt: body.lastContactedAt,
      ...body
    },
    tenantId
  );
  datasets.leads.push(lead);
  persist.leads(datasets.leads);
  return { lead: safeLead(lead) };
}

function update(id, payload, tenantId) {
  const index = datasets.leads.findIndex(l => l.id === id && matchesTenant(l.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }

  const updates = sanitizePayloadStrings(payload, [
    'name',
    'email',
    'message',
    'subject',
    'utmSource',
    'utmMedium',
    'utmCampaign',
    'utmTerm',
    'referrer',
    'assignedTo'
  ]);

  const status = updates.status && VALID_LEAD_STATUSES.includes(updates.status)
    ? updates.status
    : datasets.leads[index].status;

  const before = { ...datasets.leads[index] };
  datasets.leads[index] = { ...datasets.leads[index], ...updates, status };
  persist.leads(datasets.leads);
  auditLeadChange(tenantId, id, 'system', before, datasets.leads[index]);
  return { lead: safeLead(datasets.leads[index]) };
}

function setStatus(id, status, tenantId) {
  const index = datasets.leads.findIndex(l => l.id === id && matchesTenant(l.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }

  if (!VALID_LEAD_STATUSES.includes(status)) {
    return { error: `Status must be one of: ${VALID_LEAD_STATUSES.join(', ')}` };
  }
  const current = datasets.leads[index].status;
  if (!VALID_TRANSITIONS[current].includes(status)) {
    return { error: `Invalid status transition from ${current} to ${status}` };
  }

  const before = { ...datasets.leads[index] };
  datasets.leads[index] = { ...datasets.leads[index], status, lastContactedAt: new Date().toISOString() };
  persist.leads(datasets.leads);
  auditLeadChange(tenantId, id, 'system', before, datasets.leads[index]);
  return { lead: safeLead(datasets.leads[index]) };
}

function remove(id, tenantId) {
  const index = datasets.leads.findIndex(l => l.id === id && matchesTenant(l.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const [removed] = datasets.leads.splice(index, 1);
  persist.leads(datasets.leads);
  return { lead: safeLead(removed) };
}

function list(query = {}, tenantId) {
  const { status, sortBy = 'createdAt', sortDir = 'desc', maskPII } = query;
  const tenant = normalizeTenantId(tenantId);
  const scoped = datasets.leads.filter(lead => matchesTenant(lead.tenantId, tenant));
  const filtered = status ? scoped.filter(lead => lead.status === status) : scoped;

  const sorted = [...filtered].sort((a, b) => {
    const direction = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'name') return a.name.localeCompare(b.name) * direction;
    const aDate = new Date(a.createdAt).getTime();
    const bDate = new Date(b.createdAt).getTime();
    return (aDate - bDate) * direction;
  });

  const shouldMask = sanitizeBoolean(maskPII, false);
  const response = shouldMask ? sorted.map(lead => maskSensitiveFields(lead)) : sorted;
  return response.map(safeLead);
}

module.exports = {
  VALID_LEAD_STATUSES,
  findById,
  create,
  update,
  setStatus,
  remove,
  list
};
