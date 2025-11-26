const { datasets, persist } = require('./state');
const { clampNumber } = require('./shared');

const CACHE_TTL_MS = 30_000;
const cache = new Map();

function normalizeCapabilities() {
  datasets.capabilities = datasets.capabilities.map((capability, idx) => ({
    id: capability.id || idx + 1,
    description: capability.description,
    implemented: capability.implemented !== false,
    area: capability.area || 'core'
  }));
  persist.capabilities(datasets.capabilities);
  invalidateCache();
}

function list({ search, limit, offset }) {
  const key = JSON.stringify({ search, limit, offset });
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const filtered = datasets.capabilities.filter(capability => {
    if (!search) return true;
    return capability.description.toLowerCase().includes(search.toLowerCase());
  });

  const start = clampNumber(offset, 0);
  const end = limit ? start + clampNumber(limit, filtered.length) : filtered.length;

  const value = { total: filtered.length, items: filtered.slice(start, end) };
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
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

function invalidateCache() {
  cache.clear();
}

module.exports = {
  datasets,
  normalizeCapabilities,
  list,
  getById,
  status,
  invalidateCache
};
