const { v4: uuidv4 } = require('uuid');
const { datasets, persist } = require('./state');
const { clampNumber, sanitizeBoolean, validateFields } = require('./shared');

function list(query = {}) {
  const {
    industry,
    category,
    subcategory,
    condition,
    location,
    featured,
    minPrice,
    maxPrice,
    search,
    sortBy = 'createdAt',
    sortDir = 'desc',
    limit,
    offset
  } = query;

  const filtered = datasets.inventory
    .filter(unit => !industry || unit.industry === industry)
    .filter(unit => !category || unit.category === category)
    .filter(unit => !subcategory || unit.subcategory === subcategory)
    .filter(unit => !condition || unit.condition === condition)
    .filter(unit => !location || unit.location === location)
    .filter(unit => (featured === undefined ? true : sanitizeBoolean(featured) === Boolean(unit.featured)))
    .filter(unit => (minPrice ? Number(unit.price) >= clampNumber(minPrice, Number(unit.price)) : true))
    .filter(unit => (maxPrice ? Number(unit.price) <= clampNumber(maxPrice, Number(unit.price)) : true))
    .filter(unit => {
      if (!search) return true;
      const term = search.toLowerCase();
      return [unit.stockNumber, unit.name, unit.category, unit.subcategory, unit.location]
        .filter(Boolean)
        .some(value => value.toLowerCase().includes(term));
    });

  const sorted = [...filtered].sort((a, b) => {
    const direction = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'price') return (Number(a.price) - Number(b.price)) * direction;
    if (sortBy === 'msrp') return (Number(a.msrp) - Number(b.msrp)) * direction;
    if (sortBy === 'daysOnLot') return (Number(a.daysOnLot) - Number(b.daysOnLot)) * direction;
    const aDate = new Date(a.createdAt || 0).getTime();
    const bDate = new Date(b.createdAt || 0).getTime();
    return (aDate - bDate) * direction;
  });

  const start = clampNumber(offset, 0);
  const end = limit ? start + clampNumber(limit, filtered.length) : filtered.length;

  return {
    total: sorted.length,
    items: sorted.slice(start, end)
  };
}

function findById(id) {
  return datasets.inventory.find(u => u.id === id);
}

function create(payload) {
  const requiredError = validateFields(payload, ['stockNumber', 'name', 'condition', 'price']);
  if (requiredError) {
    return { error: requiredError };
  }

  const unit = {
    id: uuidv4(),
    featured: sanitizeBoolean(payload.featured, false),
    createdAt: new Date().toISOString(),
    images: Array.isArray(payload.images) ? payload.images : [],
    ...payload
  };

  datasets.inventory.push(unit);
  persist.inventory(datasets.inventory);
  return { unit };
}

function update(id, payload) {
  const index = datasets.inventory.findIndex(u => u.id === id);
  if (index === -1) {
    return { notFound: true };
  }

  const updated = {
    ...datasets.inventory[index],
    ...payload,
    featured: sanitizeBoolean(payload.featured, datasets.inventory[index].featured)
  };

  datasets.inventory[index] = updated;
  persist.inventory(datasets.inventory);
  return { unit: updated };
}

function setFeatured(id, featured) {
  const index = datasets.inventory.findIndex(u => u.id === id);
  if (index === -1) {
    return { notFound: true };
  }

  const updated = { ...datasets.inventory[index], featured: sanitizeBoolean(featured, true) };
  datasets.inventory[index] = updated;
  persist.inventory(datasets.inventory);
  return { unit: updated };
}

function remove(id) {
  const index = datasets.inventory.findIndex(u => u.id === id);
  if (index === -1) {
    return { notFound: true };
  }
  const [removed] = datasets.inventory.splice(index, 1);
  persist.inventory(datasets.inventory);
  return { unit: removed };
}

function stats() {
  const byCondition = datasets.inventory.reduce((acc, unit) => {
    acc[unit.condition] = (acc[unit.condition] || 0) + 1;
    return acc;
  }, {});

  const averagePrice =
    datasets.inventory.length > 0
      ? datasets.inventory.reduce((sum, unit) => sum + Number(unit.price || 0), 0) / datasets.inventory.length
      : 0;

  return {
    totalUnits: datasets.inventory.length,
    byCondition,
    averagePrice
  };
}

module.exports = {
  list,
  findById,
  create,
  update,
  setFeatured,
  remove,
  stats
};
