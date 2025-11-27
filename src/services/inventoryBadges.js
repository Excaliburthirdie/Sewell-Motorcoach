const { sanitizeString } = require('./shared');
const settingsService = require('./settingsService');

function normalizeStringArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(sanitizeString).filter(Boolean);
  return String(value)
    .split(',')
    .map(sanitizeString)
    .filter(Boolean);
}

function hasOffGridSignals(unit) {
  const batteries = normalizeStringArray(unit.batteries).join(' ').toLowerCase();
  const hasLithium = batteries.includes('lithium');
  const solar = normalizeStringArray(unit.solar || unit.solarWatts || unit.solarPrep);
  const inverter = normalizeStringArray(unit.inverter || unit.powerSystem || unit.generator);
  return hasLithium || solar.length > 0 || inverter.length > 0;
}

function hasCompactLength(unit, maxLength) {
  if (!unit.length) return false;
  const parsed = Number(unit.length);
  return Number.isFinite(parsed) && parsed < maxLength;
}

function deriveBadges(unit, tenantSettings = {}) {
  const badges = new Set();
  const badgeRules = tenantSettings.badgeRules || {};
  const nationalParkMaxLength = Number(badgeRules.nationalParkMaxLength) || 30;
  const offGridEnabled = badgeRules.offGridEnabled !== false;

  if (offGridEnabled && hasOffGridSignals(unit)) {
    badges.add('Off-Grid Ready');
  }

  if (hasCompactLength(unit, nationalParkMaxLength)) {
    badges.add('National Park Friendly');
  }

  if (unit.slides && Number(unit.slides) >= 2) {
    badges.add('Expansive Living');
  }

  if (unit.beds && Number(unit.beds) >= 3) {
    badges.add('Sleeps the Crew');
  }

  const configuredBadges = badgeRules.customRules || tenantSettings.badgeConfig || [];
  configuredBadges
    .filter(entry => entry && entry.matchField && entry.label)
    .forEach(entry => {
      const value = unit[entry.matchField];
      if (value === undefined || value === null) return;
      if (Array.isArray(value) && value.includes(entry.matchValue)) {
        badges.add(entry.label);
      } else if (!Array.isArray(value) && String(value).toLowerCase() === String(entry.matchValue).toLowerCase()) {
        badges.add(entry.label);
      }
    });

  return Array.from(badges);
}

function computeInventoryBadges(unit, tenantId) {
  const tenantSettings = settingsService.getForTenant(tenantId) || {};
  return deriveBadges(unit, tenantSettings);
}

module.exports = {
  computeInventoryBadges,
  deriveBadges
};
