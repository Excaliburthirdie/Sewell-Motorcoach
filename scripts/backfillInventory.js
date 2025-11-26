const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'inventory.json');

function loadInventory() {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read inventory data', err);
    process.exit(1);
  }
}

function saveInventory(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function backfill() {
  const inventory = loadInventory();
  const seenVins = new Map();
  const seenSlugs = new Map();

  const updated = inventory.map(unit => {
    const condition = (unit.condition || 'new').toString().toLowerCase();
    const vin = unit.vin || null;
    let slug = unit.slug || slugify(unit.name || unit.stockNumber || unit.id);
    const tenantKey = unit.tenantId || 'main';

    if (!seenSlugs.has(tenantKey)) seenSlugs.set(tenantKey, new Set());
    if (seenSlugs.get(tenantKey).has(slug)) {
      slug = `${slug}-${unit.id}`;
    }
    seenSlugs.get(tenantKey).add(slug);

    if (!seenVins.has(tenantKey)) seenVins.set(tenantKey, new Set());
    if (vin) {
      if (seenVins.get(tenantKey).has(vin)) {
        console.warn(`Duplicate VIN detected for tenant ${tenantKey}: ${vin}`);
      }
      seenVins.get(tenantKey).add(vin);
    }

    return {
      rebates: 0,
      fees: 0,
      taxes: 0,
      floorplans: [],
      virtualTours: [],
      videoLinks: [],
      transferStatus: 'none',
      holdUntil: null,
      year: unit.year || null,
      length: unit.length || null,
      weight: unit.weight || null,
      chassis: unit.chassis || null,
      metaTitle: unit.metaTitle || null,
      metaDescription: unit.metaDescription || null,
      ...unit,
      condition,
      vin,
      slug
    };
  });

  saveInventory(updated);
  console.log(`Backfilled ${updated.length} inventory records`);
}

backfill();
