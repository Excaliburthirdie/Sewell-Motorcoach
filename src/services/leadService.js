const { v4: uuidv4 } = require('uuid');
const { datasets, persist } = require('./state');
const { sanitizePayloadStrings, validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');

const VALID_LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];

function normalizedConsent(consentInput) {
  const now = new Date().toISOString();
  if (!consentInput || typeof consentInput !== 'object') {
    return {
      marketing: false,
      consentSource: 'unspecified',
      termsAcceptedAt: now,
      timestamp: now
    };
  }
  return {
    marketing: Boolean(consentInput.marketing),
    privacyPolicyVersion: consentInput.privacyPolicyVersion || 'latest',
    termsAcceptedAt: consentInput.termsAcceptedAt || now,
    consentSource: consentInput.consentSource || 'unspecified',
    timestamp: consentInput.timestamp || now,
    ip: consentInput.ip,
    userAgent: consentInput.userAgent
  };
}

function ensureConsent(lead) {
  if (!lead) return lead;
  if (!lead.consent) {
    lead.consent = normalizedConsent();
  }
  return lead;
}

function findById(id, tenantId) {
  return ensureConsent(datasets.leads.find(l => l.id === id && matchesTenant(l.tenantId, tenantId)));
}

function create(payload, tenantId) {
  const requiredError = validateFields(payload, ['name', 'email', 'message']);
  if (requiredError) {
    return { error: requiredError };
  }

  const body = sanitizePayloadStrings(payload, ['name', 'email', 'message', 'subject']);

  const consent = normalizedConsent(body.consent);

  const lead = attachTenant({
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    status: VALID_LEAD_STATUSES.includes(body.status) ? body.status : 'new',
    subject: body.subject || 'General inquiry',
    source: body.source || 'web',
    formType: body.formType || 'general',
    channel: body.channel || 'website',
    utm: body.utm || {},
    interestedUnitId: body.interestedUnitId,
    assignment: body.assignment || null,
    score: body.score || null,
    tasks: body.tasks || [],
    communications: body.communications || [],
    ...body,
    consent
  }, tenantId);
  datasets.leads.push(lead);
  persist.leads(datasets.leads);
  return { lead };
}

function update(id, payload, tenantId) {
  const index = datasets.leads.findIndex(l => l.id === id && matchesTenant(l.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }

  const updates = sanitizePayloadStrings(payload, ['name', 'email', 'message', 'subject']);

  const status = updates.status && VALID_LEAD_STATUSES.includes(updates.status)
    ? updates.status
    : datasets.leads[index].status;

  const consent = updates.consent ? normalizedConsent(updates.consent) : ensureConsent(datasets.leads[index]).consent;

  datasets.leads[index] = { ...datasets.leads[index], ...updates, status, consent };
  persist.leads(datasets.leads);
  return { lead: datasets.leads[index] };
}

function setStatus(id, status, tenantId) {
  const index = datasets.leads.findIndex(l => l.id === id && matchesTenant(l.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }

  if (!VALID_LEAD_STATUSES.includes(status)) {
    return { error: `Status must be one of: ${VALID_LEAD_STATUSES.join(', ')}` };
  }

  datasets.leads[index] = ensureConsent({ ...datasets.leads[index], status });
  persist.leads(datasets.leads);
  return { lead: datasets.leads[index] };
}

function remove(id, tenantId) {
  const index = datasets.leads.findIndex(l => l.id === id && matchesTenant(l.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const [removed] = datasets.leads.splice(index, 1);
  persist.leads(datasets.leads);
  return { lead: ensureConsent(removed) };
}

function list(query = {}, tenantId) {
  const { status, sortBy = 'createdAt', sortDir = 'desc' } = query;
  const tenant = normalizeTenantId(tenantId);
  const scoped = datasets.leads.filter(lead => matchesTenant(lead.tenantId, tenant)).map(ensureConsent);
  const filtered = status ? scoped.filter(lead => lead.status === status) : scoped;

  const sorted = [...filtered].sort((a, b) => {
    const direction = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'name') return a.name.localeCompare(b.name) * direction;
    const aDate = new Date(a.createdAt).getTime();
    const bDate = new Date(b.createdAt).getTime();
    return (aDate - bDate) * direction;
  });

  return sorted;
}

function capture(payload, tenantId) {
  return create({ ...payload, source: payload.source || 'form' }, tenantId);
}

function enrich(id, payload, tenantId) {
  const index = datasets.leads.findIndex(l => l.id === id && matchesTenant(l.tenantId, tenantId));
  if (index === -1) return { notFound: true };
  const existing = datasets.leads[index];
  const enrichment = {
    ...existing.enrichment,
    ...payload,
    enrichedAt: new Date().toISOString()
  };
  datasets.leads[index] = { ...existing, enrichment };
  persist.leads(datasets.leads);
  return { lead: ensureConsent(datasets.leads[index]) };
}

function assign(id, payload, tenantId) {
  const index = datasets.leads.findIndex(l => l.id === id && matchesTenant(l.tenantId, tenantId));
  if (index === -1) return { notFound: true };
  datasets.leads[index] = {
    ...datasets.leads[index],
    assignment: {
      ownerId: payload.ownerId,
      territory: payload.territory,
      productLine: payload.productLine,
      assignedAt: new Date().toISOString(),
      reason: payload.reason
    }
  };
  persist.leads(datasets.leads);
  return { lead: ensureConsent(datasets.leads[index]) };
}

function computeScore(lead) {
  let score = 0;
  if (lead.status === 'qualified') score += 10;
  if (lead.formType === 'finance') score += 15;
  if (lead.interestedUnitId) score += 5;
  if (lead.enrichment?.creditTier) score += 5;
  return score;
}

function scoreLead(id, tenantId) {
  const index = datasets.leads.findIndex(l => l.id === id && matchesTenant(l.tenantId, tenantId));
  if (index === -1) return { notFound: true };
  const score = computeScore(datasets.leads[index]);
  datasets.leads[index] = { ...datasets.leads[index], score };
  persist.leads(datasets.leads);
  return { lead: ensureConsent(datasets.leads[index]) };
}

function addTask(id, task, tenantId) {
  const index = datasets.leads.findIndex(l => l.id === id && matchesTenant(l.tenantId, tenantId));
  if (index === -1) return { notFound: true };
  const tasks = datasets.leads[index].tasks || [];
  tasks.push({
    id: uuidv4(),
    title: task.title,
    dueAt: task.dueAt,
    status: 'open'
  });
  datasets.leads[index] = { ...datasets.leads[index], tasks };
  persist.leads(datasets.leads);
  return { lead: ensureConsent(datasets.leads[index]) };
}

function completeTask(id, taskId, tenantId) {
  const index = datasets.leads.findIndex(l => l.id === id && matchesTenant(l.tenantId, tenantId));
  if (index === -1) return { notFound: true };
  const tasks = (datasets.leads[index].tasks || []).map(task =>
    task.id === taskId ? { ...task, status: 'done', completedAt: new Date().toISOString() } : task
  );
  datasets.leads[index] = { ...datasets.leads[index], tasks };
  persist.leads(datasets.leads);
  return { lead: ensureConsent(datasets.leads[index]) };
}

function logCommunication(id, payload, tenantId) {
  const index = datasets.leads.findIndex(l => l.id === id && matchesTenant(l.tenantId, tenantId));
  if (index === -1) return { notFound: true };
  const communications = datasets.leads[index].communications || [];
  communications.push({
    id: uuidv4(),
    channel: payload.channel || 'call',
    direction: payload.direction || 'outbound',
    summary: payload.summary,
    occurredAt: payload.occurredAt || new Date().toISOString()
  });
  datasets.leads[index] = { ...datasets.leads[index], communications };
  persist.leads(datasets.leads);
  return { lead: ensureConsent(datasets.leads[index]) };
}

module.exports = {
  VALID_LEAD_STATUSES,
  findById,
  create,
  capture,
  update,
  setStatus,
  remove,
  list,
  enrich,
  assign,
  scoreLead,
  addTask,
  completeTask,
  logCommunication
};
