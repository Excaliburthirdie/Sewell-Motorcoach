const { v4: uuidv4 } = require('uuid');
const { datasets, persist } = require('./state');
const { sanitizePayloadStrings, validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');

function list(query = {}, tenantId) {
  const { role } = query;
  const tenant = normalizeTenantId(tenantId);
  const filtered = datasets.teams
    .filter(team => matchesTenant(team.tenantId, tenant))
    .filter(team => (!role ? true : team.role === role));
  return filtered;
}

function findById(id, tenantId) {
  return datasets.teams.find(team => team.id === id && matchesTenant(team.tenantId, tenantId));
}

function create(payload, tenantId) {
  const requiredError = validateFields(payload, ['name', 'role']);
  if (requiredError) {
    return { error: requiredError };
  }
  const body = sanitizePayloadStrings(payload, ['name', 'role', 'bio']);
  const team = attachTenant({ id: uuidv4(), ...body }, tenantId);
  datasets.teams.push(team);
  persist.teams(datasets.teams);
  return { team };
}

function update(id, payload, tenantId) {
  const index = datasets.teams.findIndex(team => team.id === id && matchesTenant(team.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const body = sanitizePayloadStrings(payload, ['name', 'role', 'bio']);
  datasets.teams[index] = { ...datasets.teams[index], ...body };
  persist.teams(datasets.teams);
  return { team: datasets.teams[index] };
}

function remove(id, tenantId) {
  const index = datasets.teams.findIndex(team => team.id === id && matchesTenant(team.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const [removed] = datasets.teams.splice(index, 1);
  persist.teams(datasets.teams);
  return { team: removed };
}

module.exports = {
  list,
  findById,
  create,
  update,
  remove
};
