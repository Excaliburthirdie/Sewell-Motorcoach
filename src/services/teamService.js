const { v4: uuidv4 } = require('uuid');
const { datasets, persist } = require('./state');
const { validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');

function list(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  return datasets.teams.filter(team => matchesTenant(team.tenantId, tenant));
}

function findById(id, tenantId) {
  return datasets.teams.find(t => t.id === id && matchesTenant(t.tenantId, tenantId));
}

function create(payload, tenantId) {
  const requiredError = validateFields(payload, ['name']);
  if (requiredError) {
    return { error: requiredError };
  }

  const members = Array.isArray(payload.members)
    ? payload.members.map(member => ({
        ...member,
        socialLinks: Array.isArray(member.socialLinks) ? member.socialLinks : []
      }))
    : [];

  const team = attachTenant({ id: uuidv4(), members, ...payload }, tenantId);
  datasets.teams.push(team);
  persist.teams(datasets.teams);
  return { team };
}

function update(id, payload, tenantId) {
  const index = datasets.teams.findIndex(t => t.id === id && matchesTenant(t.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }

  const members = Array.isArray(payload.members)
    ? payload.members.map(member => ({
        ...member,
        socialLinks: Array.isArray(member.socialLinks) ? member.socialLinks : []
      }))
    : datasets.teams[index].members;

  datasets.teams[index] = { ...datasets.teams[index], ...payload, members };
  persist.teams(datasets.teams);
  return { team: datasets.teams[index] };
}

function remove(id, tenantId) {
  const index = datasets.teams.findIndex(t => t.id === id && matchesTenant(t.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const [removed] = datasets.teams.splice(index, 1);
  persist.teams(datasets.teams);
  return { team: removed };
}

function roles(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const roleSet = new Set();
  datasets.teams
    .filter(team => matchesTenant(team.tenantId, tenant))
    .forEach(team => {
      team.members?.forEach(member => {
        if (member.jobRole) roleSet.add(member.jobRole);
      });
    });
  return Array.from(roleSet);
}

module.exports = {
  list,
  findById,
  create,
  update,
  remove,
  roles
};
