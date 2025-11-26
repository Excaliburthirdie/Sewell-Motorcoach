const { datasets, persist } = require('./state');
const { clampNumber } = require('./shared');

function normalizeCapabilities() {
  datasets.capabilities = datasets.capabilities.map((capability, idx) => ({
    id: capability.id || idx + 1,
    description: capability.description,
    implemented: capability.implemented !== false,
    area: capability.area || 'core'
  }));
  persist.capabilities(datasets.capabilities);
}

function list({ search, limit, offset }) {
  const filtered = datasets.capabilities.filter(capability => {
    if (!search) return true;
    return capability.description.toLowerCase().includes(search.toLowerCase());
  });

  const start = clampNumber(offset, 0);
  const end = limit ? start + clampNumber(limit, filtered.length) : filtered.length;

  return { total: filtered.length, items: filtered.slice(start, end) };
}

function getById(id) {
  return datasets.capabilities.find(item => item.id === id);
}

function status() {
  const implemented = datasets.capabilities.filter(item => item.implemented !== false);
  return {
    total: datasets.capabilities.length,
    implemented: implemented.length,
    pending: datasets.capabilities.length - implemented.length,
    items: datasets.capabilities
  };
}

module.exports = {
  datasets,
  normalizeCapabilities,
  list,
  getById,
  status
};
