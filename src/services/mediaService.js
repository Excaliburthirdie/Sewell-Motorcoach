const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { datasets, persist } = require('./state');
const { matchesTenant } = require('./tenantService');

const VALID_MEDIA_TYPES = ['photo', '360', 'floorplan', 'video'];

function buildRenditions(url) {
  if (!config.media.optimize || !url) return [];
  const base = config.media.cdnBaseUrl || '';
  return config.media.defaultWidths.map(width => ({ width, url: `${base}${url}?w=${width}` }));
}

function listForUnit(inventoryId, tenantId) {
  const unit = datasets.inventory.find(item => item.id === inventoryId && matchesTenant(item.tenantId, tenantId));
  if (!unit) return { notFound: true };
  const media = (unit.media || []).map(entry => ({ ...entry, renditions: buildRenditions(entry.url) }));
  return { unit, media };
}

function addMedia(inventoryId, payload, tenantId) {
  const index = datasets.inventory.findIndex(item => item.id === inventoryId && matchesTenant(item.tenantId, tenantId));
  if (index === -1) return { notFound: true };

  const base = datasets.inventory[index];
  const type = VALID_MEDIA_TYPES.includes(payload.type) ? payload.type : 'photo';
  const mediaEntry = {
    id: uuidv4(),
    type,
    url: payload.url,
    caption: payload.caption || '',
    order: Number(payload.order) || (base.media?.length || 0),
    tags: payload.tags || []
  };

  const media = [...(base.media || []), mediaEntry];
  datasets.inventory[index] = { ...base, media };
  persist.inventory(datasets.inventory);
  return { unit: datasets.inventory[index], media: mediaEntry };
}

function removeMedia(inventoryId, mediaId, tenantId) {
  const index = datasets.inventory.findIndex(item => item.id === inventoryId && matchesTenant(item.tenantId, tenantId));
  if (index === -1) return { notFound: true };

  const base = datasets.inventory[index];
  const media = base.media || [];
  const mediaIndex = media.findIndex(entry => entry.id === mediaId);
  if (mediaIndex === -1) return { notFound: true };

  const [removed] = media.splice(mediaIndex, 1);
  datasets.inventory[index] = { ...base, media };
  persist.inventory(datasets.inventory);
  return { unit: datasets.inventory[index], removed };
}

module.exports = { VALID_MEDIA_TYPES, listForUnit, addMedia, removeMedia };
