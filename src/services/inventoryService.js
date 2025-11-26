const { v4: uuidv4 } = require('uuid');
const { datasets, persist } = require('./state');
const { clampNumber, sanitizeBoolean, validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');

const VALID_CONDITION_STATES = ['New', 'Used', 'Demo', 'Pending Sale', 'On Order'];
const VALID_LOCATION_STATUSES = ['On Lot', 'On Hold', 'Transfer Pending', 'In Transfer'];
const VALID_WORKFLOW_STATUSES = ['pending', 'in_progress', 'done'];

function numberOrFallback(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeFees(fees = []) {
  if (!Array.isArray(fees)) return [];
  return fees.map(fee => ({
    type: fee.type || 'fee',
    amount: numberOrFallback(fee.amount, 0)
  }));
}

function list(query = {}, tenantId) {
  const {
    industry,
    category,
    subcategory,
    condition,
    location,
    lotId,
    locationStatus,
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
    .filter(unit => !lotId || unit.lotId === lotId)
    .filter(unit => !locationStatus || unit.locationStatus === locationStatus)
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
    if (sortBy === 'year') return (Number(a.year) - Number(b.year)) * direction;
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
  const requiredError = validateFields(payload, ['stockNumber', 'name', 'vin', 'year', 'condition', 'price']);
  if (requiredError) {
    return { error: requiredError };
  }

  const unit = attachTenant({
    id: uuidv4(),
    featured: sanitizeBoolean(payload.featured, false),
    createdAt: new Date().toISOString(),
    images: Array.isArray(payload.images) ? payload.images : [],
    media: Array.isArray(payload.media) ? payload.media : [],
    workflows: payload.workflows || {
      reconditioning: { status: 'pending', notes: [] },
      detail: { status: 'pending', notes: [] },
      photography: { status: 'pending', notes: [] }
    },
    ...payload,
    locationStatus: VALID_LOCATION_STATUSES.includes(payload.locationStatus) ? payload.locationStatus : 'On Lot',
    hold: null,
    transfer: null,
    msrp: payload.msrp !== undefined ? numberOrFallback(payload.msrp, payload.price) : numberOrFallback(payload.price, 0),
    salePrice: payload.salePrice !== undefined ? numberOrFallback(payload.salePrice, payload.price) : numberOrFallback(payload.price, 0),
    rebates: numberOrFallback(payload.rebates, 0),
    taxes: numberOrFallback(payload.taxes, 0),
    fees: normalizeFees(payload.fees),
    length: payload.length !== undefined ? numberOrFallback(payload.length, undefined) : undefined,
    weight: payload.weight !== undefined ? numberOrFallback(payload.weight, undefined) : undefined
  }, tenantId);

  if (!VALID_CONDITION_STATES.includes(unit.condition)) {
    unit.condition = 'New';
  }

  datasets.inventory.push(unit);
  persist.inventory(datasets.inventory);
  return { unit };
}

function update(id, payload, tenantId) {
  const index = datasets.inventory.findIndex(u => u.id === id && matchesTenant(u.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }

  const previous = { ...datasets.inventory[index] };
  const base = datasets.inventory[index];
  const updated = {
    ...base,
    ...payload,
    featured: sanitizeBoolean(payload.featured, base.featured),
    locationStatus: VALID_LOCATION_STATUSES.includes(payload.locationStatus)
      ? payload.locationStatus
      : base.locationStatus || 'On Lot',
    hold: payload.hold !== undefined ? payload.hold : base.hold || null,
    transfer: payload.transfer !== undefined ? payload.transfer : base.transfer || null,
    msrp: payload.msrp !== undefined ? numberOrFallback(payload.msrp, base.msrp) : base.msrp,
    salePrice: payload.salePrice !== undefined ? numberOrFallback(payload.salePrice, base.salePrice) : base.salePrice,
    rebates: payload.rebates !== undefined ? numberOrFallback(payload.rebates, base.rebates || 0) : base.rebates,
    taxes: payload.taxes !== undefined ? numberOrFallback(payload.taxes, base.taxes || 0) : base.taxes,
    fees: payload.fees !== undefined ? normalizeFees(payload.fees) : base.fees || [],
    length: payload.length !== undefined ? numberOrFallback(payload.length, base.length) : base.length,
    weight: payload.weight !== undefined ? numberOrFallback(payload.weight, base.weight) : base.weight,
    workflows: payload.workflows || base.workflows || {},
    media: payload.media || base.media || []
  };

  if (!VALID_CONDITION_STATES.includes(updated.condition)) {
    updated.condition = base.condition || 'New';
  }

  datasets.inventory[index] = updated;
  persist.inventory(datasets.inventory);
  return { unit: updated, previous };
}

function updateLocation(id, payload, tenantId) {
  const index = datasets.inventory.findIndex(u => u.id === id && matchesTenant(u.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }

  const previous = { ...datasets.inventory[index] };
  const base = datasets.inventory[index];
  const status =
    payload.locationStatus && VALID_LOCATION_STATUSES.includes(payload.locationStatus)
      ? payload.locationStatus
      : base.locationStatus || 'On Lot';

  const updated = {
    ...base,
    location: payload.location || base.location,
    lotId: payload.lotId !== undefined ? payload.lotId : base.lotId,
    locationStatus: status,
    transfer: ['Transfer Pending', 'In Transfer'].includes(status) ? base.transfer : null
  };

  datasets.inventory[index] = updated;
  persist.inventory(datasets.inventory);
  return { unit: updated, previous };
}

function setHold(id, payload, tenantId) {
  const index = datasets.inventory.findIndex(u => u.id === id && matchesTenant(u.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }

  const previous = { ...datasets.inventory[index] };
  const base = datasets.inventory[index];

  const updated = {
    ...base,
    hold: payload.hold
      ? {
          reason: payload.reason || base.hold?.reason || null,
          holdUntil: payload.holdUntil || base.hold?.holdUntil || null,
          setAt: new Date().toISOString()
        }
      : null,
    locationStatus: payload.hold ? 'On Hold' : 'On Lot'
  };

  datasets.inventory[index] = updated;
  persist.inventory(datasets.inventory);
  return { unit: updated, previous };
}

function updateTransfer(id, payload, tenantId) {
  const index = datasets.inventory.findIndex(u => u.id === id && matchesTenant(u.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }

  const previous = { ...datasets.inventory[index] };
  const base = datasets.inventory[index];

  const status = payload.status || 'Transfer Pending';
  const transfer = {
    toLotId: payload.toLotId,
    toLocation: payload.toLocation,
    status,
    requestedAt: base.transfer?.requestedAt || new Date().toISOString()
  };

  const updated = {
    ...base,
    transfer,
    locationStatus: status === 'Received' ? 'On Lot' : status
  };

  if (status === 'Received') {
    updated.location = payload.toLocation;
    updated.lotId = payload.toLotId;
    updated.transfer = null;
  }

  datasets.inventory[index] = updated;
  persist.inventory(datasets.inventory);
  return { unit: updated, previous };
}

function updateWorkflow(id, payload, tenantId) {
  const index = datasets.inventory.findIndex(u => u.id === id && matchesTenant(u.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }

  const base = datasets.inventory[index];
  const workflows = { ...base.workflows };

  ['reconditioning', 'detail', 'photography'].forEach(key => {
    if (payload[key]) {
      const next = payload[key];
      const status = VALID_WORKFLOW_STATUSES.includes(next.status) ? next.status : workflows[key]?.status || 'pending';
      workflows[key] = {
        status,
        notes: next.notes || workflows[key]?.notes || [],
        updatedAt: new Date().toISOString()
      };
    }
  });

  datasets.inventory[index] = { ...base, workflows };
  persist.inventory(datasets.inventory);
  return { unit: datasets.inventory[index] };
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
  updateLocation,
  setHold,
  updateTransfer,
  updateWorkflow,
  setFeatured,
  remove,
  stats
};
