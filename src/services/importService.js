const { datasets, persist } = require('./state');
const { attachTenant, matchesTenant } = require('./tenantService');
const inventoryService = require('./inventoryService');

function parseCsv(csv = '') {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    return headers.reduce((acc, header, idx) => {
      acc[header] = cells[idx];
      return acc;
    }, {});
  });
}

function toCsv(rows = []) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  rows.forEach(row => {
    lines.push(headers.map(h => row[h]).join(','));
  });
  return lines.join('\n');
}

function importInventory(csvPayload, tenantId) {
  const parsed = parseCsv(csvPayload || '');
  const created = [];
  parsed.forEach(row => {
    const payload = {
      stockNumber: row.stockNumber,
      name: row.name,
      vin: row.vin,
      year: Number(row.year) || undefined,
      price: Number(row.price) || 0,
      condition: row.condition || 'New',
      location: row.location,
      category: row.category,
      subcategory: row.subcategory
    };
    const { unit } = inventoryService.create(payload, tenantId);
    if (unit) created.push(unit);
  });
  return created;
}

function exportInventory(tenantId) {
  const scoped = datasets.inventory.filter(item => matchesTenant(item.tenantId, tenantId));
  const simplified = scoped.map(item =>
    attachTenant(
      {
        stockNumber: item.stockNumber,
        name: item.name,
        vin: item.vin,
        year: item.year,
        price: item.price,
        condition: item.condition,
        location: item.location,
        category: item.category,
        subcategory: item.subcategory
      },
      tenantId
    )
  );
  return toCsv(simplified);
}

module.exports = { importInventory, exportInventory };
