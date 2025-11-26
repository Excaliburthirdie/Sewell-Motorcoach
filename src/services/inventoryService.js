const { v4: uuidv4 } = require('uuid');
const { datasets, persist } = require('./state');
const { clampNumber, escapeOutputPayload, sanitizeBoolean, sanitizeString, validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');
const { INVENTORY_CONDITIONS, TRANSFER_STATUSES } = require('../validation/schemas');

const PRICING_FIELDS = ['price', 'msrp', 'salePrice', 'rebates', 'fees', 'taxes'];

function calculateTotalPrice(unit) {
  const price = Number(unit.price || 0);
  const rebates = Number(unit.rebates || 0);
  const fees = Number(unit.fees || 0);
  const taxes = Number(unit.taxes || 0);
  return price - rebates + fees + taxes;
}

function sanitizeCondition(condition) {
  if (!condition) return undefined;
  const lowered = condition.toLowerCase();
  return INVENTORY_CONDITIONS.includes(lowered) ? lowered : condition;
}

function sanitizeTransferStatus(status) {
  if (!status) return undefined;
  const lowered = status.toLowerCase();
  return TRANSFER_STATUSES.includes(lowered) ? lowered : status;
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
    .filter(unit => !transferStatus || sanitizeTransferStatus(unit.transferStatus) === transferStatus)
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
    limit: clampNumber(limit, sorted.length),
    offset: start,
    items: sorted.slice(start, end).map(safeUnit)
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
  const requiredError = validateFields(payload, ['stockNumber', 'name', 'condition', 'price']);
  if (requiredError) {
    return { error: requiredError };
  }

  const normalizedCondition = sanitizeCondition(payload.condition) || 'new';

  if (hasVinConflict(payload.vin, tenantId)) {
    return { conflict: 'VIN already exists for this tenant' };
  }

  const slug = payload.slug || slugify(payload.name || payload.stockNumber);
  if (hasSlugConflict(slug, tenantId)) {
    return { conflict: 'Slug already exists for this tenant' };
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
      ...payload,
      condition: normalizedCondition,
      transferStatus: sanitizeTransferStatus(payload.transferStatus) || 'none',
      holdUntil: payload.holdUntil,
      rebates: Number(payload.rebates || 0),
      fees: Number(payload.fees || 0),
      taxes: Number(payload.taxes || 0),
      vin: payload.vin ? sanitizeString(payload.vin) : undefined,
      slug
    },
    tenantId
  );

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

function parseListField(value) {
  if (!value) return [];
  return String(value)
    .split('|')
    .map(entry => sanitizeString(entry))
    .filter(Boolean);
}

function normalizeRowPayload(row) {
  const numericFields = ['price', 'msrp', 'salePrice', 'rebates', 'fees', 'taxes', 'year', 'length', 'weight', 'daysOnLot'];
  const payload = { ...row };
  numericFields.forEach(field => {
    if (payload[field] !== undefined) {
      const value = Number(payload[field]);
      payload[field] = Number.isFinite(value) ? value : undefined;
    }
  });

  if (payload.featured !== undefined) {
    payload.featured = sanitizeBoolean(payload.featured, false);
  }

  ['images', 'floorplans', 'virtualTours', 'videoLinks'].forEach(field => {
    if (payload[field] && typeof payload[field] === 'string') {
      payload[field] = parseListField(payload[field]);
    }
  });

  if (payload.condition) payload.condition = sanitizeCondition(payload.condition);
  if (payload.transferStatus) payload.transferStatus = sanitizeTransferStatus(payload.transferStatus);
  if (payload.slug) payload.slug = slugify(payload.slug);

  return payload;
}

function importCsv(csv, tenantId) {
  const rows = csv
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (rows.length <= 1) {
    return { created: 0, errors: [{ row: 0, message: 'No data rows provided' }] };
  }

  const headers = rows[0].split(',').map(header => header.trim());
  const createdUnits = [];
  const errors = [];

  for (let i = 1; i < rows.length; i++) {
    const columns = rows[i].split(',');
    const row = headers.reduce((acc, header, idx) => ({ ...acc, [header]: columns[idx] }), {});
    const payload = normalizeRowPayload(row);
    const result = create(payload, tenantId);
    if (result.error || result.conflict) {
      errors.push({ row: i + 1, message: result.error || result.conflict });
      continue;
    }
    createdUnits.push(result.unit);
  }

  return { created: createdUnits.length, errors, items: createdUnits };
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
