const { v4: uuidv4 } = require('uuid');
const { datasets, persist } = require('./state');
const { validateFields } = require('./shared');

function list() {
  return datasets.teams;
}

function findById(id) {
  return datasets.teams.find(t => t.id === id);
}

function create(payload) {
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

  const team = { id: uuidv4(), members, ...payload };
  datasets.teams.push(team);
  persist.teams(datasets.teams);
  return { team };
}

function update(id, payload) {
  const index = datasets.teams.findIndex(t => t.id === id);
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

function remove(id) {
  const index = datasets.teams.findIndex(t => t.id === id);
  if (index === -1) {
    return { notFound: true };
  }
  const [removed] = datasets.teams.splice(index, 1);
  persist.teams(datasets.teams);
  return { team: removed };
}

function roles() {
  const roleSet = new Set();
  datasets.teams.forEach(team => {
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
