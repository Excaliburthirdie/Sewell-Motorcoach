const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { datasets } = require('./state');
const { DATA_DIR } = require('../persistence/store');

function filterTenant(collection, tenantId) {
  return (collection || []).filter(item => !tenantId || item.tenantId === tenantId || !item.tenantId);
}

function buildSnapshot(tenantId) {
  const snapshot = {
    generatedAt: new Date().toISOString(),
    tenantId,
    counts: {},
    datasets: {}
  };

  const sources = {
    inventory: datasets.inventory,
    leads: datasets.leads,
    customers: datasets.customers,
    serviceTickets: datasets.serviceTickets,
    financeOffers: datasets.financeOffers,
    contentPages: datasets.contentPages,
    reviews: datasets.reviews,
    teams: datasets.teams,
    seoProfiles: datasets.seoProfiles
  };

  Object.entries(sources).forEach(([key, value]) => {
    const filtered = filterTenant(value, tenantId);
    snapshot.datasets[key] = filtered;
    snapshot.counts[key] = filtered.length;
  });

  return snapshot;
}

function generateCompressedSnapshot(tenantId) {
  const snapshot = buildSnapshot(tenantId);
  const json = JSON.stringify(snapshot, null, 2);
  const compressed = zlib.gzipSync(Buffer.from(json));
  const fileName = `export-${tenantId || 'all'}-${Date.now()}.json.gz`;
  const filePath = path.join(DATA_DIR, fileName);
  fs.writeFileSync(filePath, compressed);
  return { fileName, filePath, sizeBytes: compressed.byteLength, snapshot };
}

module.exports = {
  buildSnapshot,
  generateCompressedSnapshot
};
