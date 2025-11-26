const { v4: uuidv4 } = require('uuid');
const { datasets, persist } = require('./state');
const { clampNumber, escapeOutputPayload, sanitizeBoolean, sanitizeString, validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');
const { INVENTORY_CONDITIONS, TRANSFER_STATUSES } = require('../validation/schemas');

const PRICING_FIELDS = ['price', 'msrp', 'salePrice', 'fees', 'taxes', 'rebates'];

function calculateTotalPrice(unit) {
  const price = Number(unit.salePrice ?? unit.price ?? 0);
  const fees = Number(unit.fees ?? 0);
  const taxes = Number(unit.taxes ?? 0);
  const rebates = Number(unit.rebates ?? 0);
  return Math.max(0, price + fees + taxes - rebates);
}

function safeUnit(unit) {
  return escapeOutputPayload({ ...unit, totalPrice: calculateTotalPrice(unit) });
}

function list(query = {}, tenantId) {
  const {
    industry,
    category,
    subcategory,
    condition,
    location,
    transferStatus,
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
    .filter(unit => !condition || sanitizeCondition(unit.condition) === condition)
    .filter(unit => !location || unit.location === location)
    .filter(unit => !transferStatus || unit.transferStatus === transferStatus)
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

  const appliedLimit = limit ? clampNumber(limit, filtered.length) : undefined;

  return {
    items: sorted.slice(start, end).map(safeUnit),
    meta: {
      total: sorted.length,
      limit: appliedLimit,
      offset: start
    }
  };
}

function findById(id, tenantId) {
  const unit = datasets.inventory.find(u => u.id === id && matchesTenant(u.tenantId, tenantId));
  return unit ? safeUnit(unit) : undefined;
}

function findBySlug(slug, tenantId) {
  const unit = datasets.inventory.find(u => u.slug === slug && matchesTenant(u.tenantId, tenantId));
  return unit ? safeUnit(unit) : undefined;
}

function slugify(value) {
  if (!value) return undefined;
  return sanitizeString(String(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function hasVinConflict(vin, tenantId, currentId) {
  if (!vin) return false;
  return datasets.inventory.some(
    unit => matchesTenant(unit.tenantId, tenantId) && unit.vin === vin && unit.id !== currentId
  );
}

function hasSlugConflict(slug, tenantId, currentId) {
  if (!slug) return false;
  return datasets.inventory.some(
    unit => matchesTenant(unit.tenantId, tenantId) && unit.slug === slug && unit.id !== currentId
  );
}

function create(payload, tenantId) {
  const requiredError = validateFields(payload, ['stockNumber', 'vin', 'name', 'condition', 'price']);
  if (requiredError) {
    return { error: requiredError };
  }

  const normalizedTenant = normalizeTenantId(tenantId);
  const vinExists = datasets.inventory.some(
    unit => matchesTenant(unit.tenantId, normalizedTenant) && unit.vin === payload.vin
  );
  if (vinExists) {
    return { error: 'VIN must be unique per tenant' };
  }
  if (payload.slug) {
    const slugExists = datasets.inventory.some(
      unit => matchesTenant(unit.tenantId, normalizedTenant) && unit.slug === payload.slug
    );
    if (slugExists) {
      return { error: 'Slug must be unique per tenant' };
    }
  }

  const unit = attachTenant(
    {
      id: uuidv4(),
      featured: sanitizeBoolean(payload.featured, false),
      createdAt: new Date().toISOString(),
      images: Array.isArray(payload.images) ? payload.images : [],
      floorplans: Array.isArray(payload.floorplans) ? payload.floorplans : [],
      virtualTours: Array.isArray(payload.virtualTours) ? payload.virtualTours : [],
      videoLinks: Array.isArray(payload.videoLinks) ? payload.videoLinks : [],
      ...payload
    },
    tenantId
  );

  unit.totalPrice = calculateTotalPrice(unit);

  datasets.inventory.push(unit);
  persist.inventory(datasets.inventory);
  return { unit: safeUnit(unit) };
}

function update(id, payload, tenantId) {
  const index = datasets.inventory.findIndex(u => u.id === id && matchesTenant(u.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }

  if (hasVinConflict(payload.vin, tenantId, id)) {
    return { conflict: 'VIN already exists for this tenant' };
  }

  const proposedSlug = payload.slug || datasets.inventory[index].slug || slugify(payload.name || datasets.inventory[index].name);
  if (hasSlugConflict(proposedSlug, tenantId, id)) {
    return { conflict: 'Slug already exists for this tenant' };
  }

  const previous = { ...datasets.inventory[index] };
  const updated = {
    ...previous,
    ...payload,
    featured: sanitizeBoolean(payload.featured, datasets.inventory[index].featured),
    condition: sanitizeCondition(payload.condition) || previous.condition,
    transferStatus: sanitizeTransferStatus(payload.transferStatus) || previous.transferStatus,
    rebates: payload.rebates !== undefined ? Number(payload.rebates) : previous.rebates || 0,
    fees: payload.fees !== undefined ? Number(payload.fees) : previous.fees || 0,
    taxes: payload.taxes !== undefined ? Number(payload.taxes) : previous.taxes || 0,
    vin: payload.vin ? sanitizeString(payload.vin) : previous.vin,
    slug: proposedSlug
  };

  const normalizedTenant = normalizeTenantId(tenantId);
  const vinExists = datasets.inventory.some(
    unit => unit.vin === updated.vin && matchesTenant(unit.tenantId, normalizedTenant) && unit.id !== id
  );
  if (vinExists) {
    return { error: 'VIN must be unique per tenant' };
  }
  if (updated.slug) {
    const slugExists = datasets.inventory.some(
      unit => unit.slug === updated.slug && matchesTenant(unit.tenantId, normalizedTenant) && unit.id !== id
    );
    if (slugExists) {
      return { error: 'Slug must be unique per tenant' };
    }
  }

  updated.totalPrice = calculateTotalPrice(updated);

  const pricingChanges = PRICING_FIELDS.reduce((changes, field) => {
    const before = previous[field];
    const after = updated[field];
    if (before === undefined && after === undefined) return changes;
    const beforeNumber = before === undefined ? undefined : Number(before);
    const afterNumber = after === undefined ? undefined : Number(after);
    if (Number.isFinite(beforeNumber) && Number.isFinite(afterNumber) && beforeNumber !== afterNumber) {
      changes.push({ field, previous: beforeNumber, next: afterNumber });
    }
    return changes;
  }, []);

  datasets.inventory[index] = updated;
  persist.inventory(datasets.inventory);
  return { unit: safeUnit(updated), previous, pricingChanges };
}

function setFeatured(id, featured, tenantId) {
  const index = datasets.inventory.findIndex(u => u.id === id && matchesTenant(u.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }

  const updated = { ...datasets.inventory[index], featured: sanitizeBoolean(featured, true) };
  datasets.inventory[index] = updated;
  persist.inventory(datasets.inventory);
  return { unit: safeUnit(updated) };
}

function remove(id, tenantId) {
  const index = datasets.inventory.findIndex(u => u.id === id && matchesTenant(u.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const [removed] = datasets.inventory.splice(index, 1);
  persist.inventory(datasets.inventory);
  return { unit: safeUnit(removed) };
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

function findBySlug(slug, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const unit = datasets.inventory.find(item => matchesTenant(item.tenantId, tenant) && item.slug === slug);
  return unit ? safeUnit(unit) : undefined;
}

module.exports = {
  list,
  findById,
  findBySlug,
  create,
  update,
  setFeatured,
  remove,
  stats,
  importCsv
};
