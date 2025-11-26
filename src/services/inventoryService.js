const { v4: uuidv4 } = require('uuid');
const { datasets, persist } = require('./state');
const { clampNumber, sanitizeBoolean, validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');

function list(query = {}, tenantId) {
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

  const tenant = normalizeTenantId(tenantId);
  const filtered = datasets.inventory
    .filter(unit => matchesTenant(unit.tenantId, tenant))
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

function findById(id, tenantId) {
  return datasets.inventory.find(u => u.id === id && matchesTenant(u.tenantId, tenantId));
}

function create(payload, tenantId) {
  const requiredError = validateFields(payload, ['stockNumber', 'name', 'condition', 'price', 'vin', 'year']);
  if (requiredError) {
    return { error: requiredError };
  }

  const unit = attachTenant(
    {
      id: uuidv4(),
      featured: sanitizeBoolean(payload.featured, false),
      createdAt: new Date().toISOString(),
      images: Array.isArray(payload.images) ? payload.images : [],
      price: Number(payload.price),
      msrp: payload.msrp !== undefined ? Number(payload.msrp) : undefined,
      salePrice: payload.salePrice !== undefined ? Number(payload.salePrice) : undefined,
      rebates: payload.rebates !== undefined ? Number(payload.rebates) : undefined,
      taxes: payload.taxes !== undefined ? Number(payload.taxes) : undefined,
      fees: payload.fees !== undefined ? Number(payload.fees) : undefined,
      year: Number(payload.year),
      length: payload.length !== undefined ? Number(payload.length) : undefined,
      weight: payload.weight !== undefined ? Number(payload.weight) : undefined,
      ...payload
    },
    tenantId
  );

  datasets.inventory.push(unit);
  persist.inventory(datasets.inventory);
  return { unit };
}

function update(id, payload, tenantId) {
  const index = datasets.inventory.findIndex(u => u.id === id && matchesTenant(u.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }

  const updated = {
    ...datasets.inventory[index],
    ...payload,
    featured: sanitizeBoolean(payload.featured, datasets.inventory[index].featured),
    price: payload.price !== undefined ? Number(payload.price) : datasets.inventory[index].price,
    msrp: payload.msrp !== undefined ? Number(payload.msrp) : datasets.inventory[index].msrp,
    salePrice: payload.salePrice !== undefined ? Number(payload.salePrice) : datasets.inventory[index].salePrice,
    rebates: payload.rebates !== undefined ? Number(payload.rebates) : datasets.inventory[index].rebates,
    taxes: payload.taxes !== undefined ? Number(payload.taxes) : datasets.inventory[index].taxes,
    fees: payload.fees !== undefined ? Number(payload.fees) : datasets.inventory[index].fees,
    year: payload.year !== undefined ? Number(payload.year) : datasets.inventory[index].year,
    length: payload.length !== undefined ? Number(payload.length) : datasets.inventory[index].length,
    weight: payload.weight !== undefined ? Number(payload.weight) : datasets.inventory[index].weight
  };

  datasets.inventory[index] = updated;
  persist.inventory(datasets.inventory);
  return { unit: updated };
}

function setFeatured(id, featured, tenantId) {
  const index = datasets.inventory.findIndex(u => u.id === id && matchesTenant(u.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }

  const updated = { ...datasets.inventory[index], featured: sanitizeBoolean(featured, true) };
  datasets.inventory[index] = updated;
  persist.inventory(datasets.inventory);
  return { unit: updated };
}

function remove(id, tenantId) {
  const index = datasets.inventory.findIndex(u => u.id === id && matchesTenant(u.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const [removed] = datasets.inventory.splice(index, 1);
  persist.inventory(datasets.inventory);
  return { unit: removed };
}

function stats(tenantId) {
  const tenantInventory = datasets.inventory.filter(unit => matchesTenant(unit.tenantId, tenantId));

  const byCondition = tenantInventory.reduce((acc, unit) => {
    acc[unit.condition] = (acc[unit.condition] || 0) + 1;
    return acc;
  }, {});

  const averagePrice =
    tenantInventory.length > 0
      ? tenantInventory.reduce((sum, unit) => sum + Number(unit.price || 0), 0) / tenantInventory.length
      : 0;

  return {
    totalUnits: tenantInventory.length,
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
