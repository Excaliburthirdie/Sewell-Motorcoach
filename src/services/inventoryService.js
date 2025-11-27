const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { clampNumber, escapeOutputPayload, sanitizeBoolean, sanitizeString, validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');
const {
  constants: { INVENTORY_CONDITIONS, TRANSFER_STATUSES }
} = require('../validation/schemas');

const PRICING_FIELDS = ['price', 'msrp', 'salePrice', 'fees', 'taxes', 'rebates'];

const parseList = value => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(sanitizeString);
  return String(value)
    .split('|')
    .map(item => sanitizeString(item))
    .filter(Boolean);
};

const parseNumber = value => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

function sanitizeCondition(value, fallback) {
  if (!value) return fallback;
  const normalized = sanitizeString(value).toLowerCase();
  return INVENTORY_CONDITIONS.includes(normalized) ? normalized : fallback;
}

function sanitizeTransferStatus(value, fallback = 'none') {
  if (!value) return fallback;
  const normalized = sanitizeString(value).toLowerCase();
  return TRANSFER_STATUSES.includes(normalized) ? normalized : fallback;
}

function sanitizeHoldUntil(value) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

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

  const minPriceValue = Number(minPrice);
  const maxPriceValue = Number(maxPrice);

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
    .filter(unit => {
      if (!Number.isFinite(minPriceValue)) return true;
      return calculateTotalPrice(unit) >= minPriceValue;
    })
    .filter(unit => {
      if (!Number.isFinite(maxPriceValue)) return true;
      return calculateTotalPrice(unit) <= maxPriceValue;
    })
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
  const clampedLimit = limit === undefined ? undefined : clampNumber(limit, filtered.length);
  const end = clampedLimit === undefined ? filtered.length : start + clampedLimit;

  const appliedLimit = clampedLimit;

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
  const tenant = normalizeTenantId(tenantId);
  const unit = datasets.inventory.find(item => matchesTenant(item.tenantId, tenant) && item.slug === slug);
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

  const normalizedCondition = sanitizeCondition(payload.condition, 'new');
  const normalizedTransfer = sanitizeTransferStatus(payload.transferStatus, 'none');
  const holdUntil = sanitizeHoldUntil(payload.holdUntil);
  const slug = payload.slug ? slugify(payload.slug) : slugify(payload.name || payload.stockNumber);

  const normalizedTenant = normalizeTenantId(tenantId);
  const vinExists = datasets.inventory.some(
    unit => matchesTenant(unit.tenantId, normalizedTenant) && unit.vin === payload.vin
  );
  if (vinExists) {
    return { error: 'VIN must be unique per tenant' };
  }
  if (slug) {
    const slugExists = datasets.inventory.some(
      unit => matchesTenant(unit.tenantId, normalizedTenant) && unit.slug === slug
    );
    if (slugExists) {
      return { error: 'Slug must be unique per tenant' };
    }
  }

  const unit = attachTenant(
    {
      id: randomUUID(),
      featured: sanitizeBoolean(payload.featured, false),
      createdAt: new Date().toISOString(),
      images: Array.isArray(payload.images) ? payload.images : [],
      floorplans: Array.isArray(payload.floorplans) ? payload.floorplans : [],
      virtualTours: Array.isArray(payload.virtualTours) ? payload.virtualTours : [],
      videoLinks: Array.isArray(payload.videoLinks) ? payload.videoLinks : [],
      condition: normalizedCondition,
      transferStatus: normalizedTransfer,
      holdUntil,
      slug,
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

  const proposedSlug =
    slugify(payload.slug || payload.name) || datasets.inventory[index].slug || slugify(datasets.inventory[index].name);
  if (hasSlugConflict(proposedSlug, tenantId, id)) {
    return { conflict: 'Slug already exists for this tenant' };
  }

  const previous = { ...datasets.inventory[index] };
  const updated = {
    ...previous,
    ...payload,
    featured: sanitizeBoolean(payload.featured, datasets.inventory[index].featured),
    condition: sanitizeCondition(payload.condition, previous.condition),
    transferStatus: sanitizeTransferStatus(payload.transferStatus, previous.transferStatus),
    rebates: payload.rebates !== undefined ? Number(payload.rebates) : previous.rebates || 0,
    fees: payload.fees !== undefined ? Number(payload.fees) : previous.fees || 0,
    taxes: payload.taxes !== undefined ? Number(payload.taxes) : previous.taxes || 0,
    vin: payload.vin ? sanitizeString(payload.vin) : previous.vin,
    slug: proposedSlug,
    holdUntil: sanitizeHoldUntil(payload.holdUntil) || previous.holdUntil
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

function importCsv(csv, tenantId) {
  const lines = csv
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { created: [], errors: ['CSV payload is empty'] };
  }

  const headers = lines[0].split(',').map(h => h.trim());
  const created = [];
  const errors = [];

  for (let i = 1; i < lines.length; i += 1) {
    const rawRow = lines[i];
    const columns = rawRow.split(',');
    if (columns.length !== headers.length) {
      errors.push(`Row ${i} has ${columns.length} columns, expected ${headers.length}`);
      continue;
    }

    const row = headers.reduce((acc, header, index) => {
      acc[header] = columns[index]?.trim();
      return acc;
    }, {});

    const payload = {
      stockNumber: row.stockNumber || row.stock_number,
      vin: row.vin,
      name: row.name,
      condition: row.condition,
      price: parseNumber(row.price),
      msrp: parseNumber(row.msrp),
      salePrice: parseNumber(row.salePrice || row.sale_price),
      rebates: parseNumber(row.rebates),
      fees: parseNumber(row.fees),
      taxes: parseNumber(row.taxes),
      year: parseNumber(row.year),
      length: parseNumber(row.length),
      weight: parseNumber(row.weight),
      chassis: row.chassis,
      industry: row.industry,
      category: row.category,
      subcategory: row.subcategory,
      location: row.location,
      lotCode: row.lotCode || row.lot_code,
      transferStatus: row.transferStatus || row.transfer_status,
      holdUntil: row.holdUntil || row.hold_until,
      featured: row.featured === 'true',
      slug: row.slug,
      description: row.description,
      metaTitle: row.metaTitle || row.meta_title,
      metaDescription: row.metaDescription || row.meta_description,
      images: parseList(row.images),
      floorplans: parseList(row.floorplans),
      virtualTours: parseList(row.virtualTours || row.virtual_tours),
      videoLinks: parseList(row.videoLinks || row.video_links)
    };

    const result = create(payload, tenantId);
    if (result.error || result.conflict) {
      errors.push(`Row ${i}: ${result.error || result.conflict}`);
    } else {
      created.push(result.unit);
    }
  }

  return { created, errors };
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
