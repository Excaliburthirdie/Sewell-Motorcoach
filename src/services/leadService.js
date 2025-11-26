const { v4: uuidv4 } = require('uuid');
const { datasets, persist } = require('./state');
const { sanitizePayloadStrings, validateFields } = require('./shared');

const VALID_LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];

function findById(id) {
  return datasets.leads.find(l => l.id === id);
}

function create(payload) {
  const requiredError = validateFields(payload, ['name', 'email', 'message']);
  if (requiredError) {
    return { error: requiredError };
  }

  const body = sanitizePayloadStrings(payload, ['name', 'email', 'message', 'subject']);

  const lead = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    status: VALID_LEAD_STATUSES.includes(body.status) ? body.status : 'new',
    subject: body.subject || 'General inquiry',
    ...body
  };
  datasets.leads.push(lead);
  persist.leads(datasets.leads);
  return { lead };
}

function update(id, payload) {
  const index = datasets.leads.findIndex(l => l.id === id);
  if (index === -1) {
    return { notFound: true };
  }

  const updates = sanitizePayloadStrings(payload, ['name', 'email', 'message', 'subject']);

  const status = updates.status && VALID_LEAD_STATUSES.includes(updates.status)
    ? updates.status
    : datasets.leads[index].status;

  datasets.leads[index] = { ...datasets.leads[index], ...updates, status };
  persist.leads(datasets.leads);
  return { lead: datasets.leads[index] };
}

function setStatus(id, status) {
  const index = datasets.leads.findIndex(l => l.id === id);
  if (index === -1) {
    return { notFound: true };
  }

  if (!VALID_LEAD_STATUSES.includes(status)) {
    return { error: `Status must be one of: ${VALID_LEAD_STATUSES.join(', ')}` };
  }

  datasets.leads[index] = { ...datasets.leads[index], status };
  persist.leads(datasets.leads);
  return { lead: datasets.leads[index] };
}

function remove(id) {
  const index = datasets.leads.findIndex(l => l.id === id);
  if (index === -1) {
    return { notFound: true };
  }
  const [removed] = datasets.leads.splice(index, 1);
  persist.leads(datasets.leads);
  return { lead: removed };
}

function list(query = {}) {
  const { status, sortBy = 'createdAt', sortDir = 'desc' } = query;
  const filtered = status ? datasets.leads.filter(lead => lead.status === status) : datasets.leads;

  const sorted = [...filtered].sort((a, b) => {
    const direction = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'name') return a.name.localeCompare(b.name) * direction;
    const aDate = new Date(a.createdAt).getTime();
    const bDate = new Date(b.createdAt).getTime();
    return (aDate - bDate) * direction;
  });

  return sorted;
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
