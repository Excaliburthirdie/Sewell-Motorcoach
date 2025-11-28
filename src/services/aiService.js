const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { escapeOutputPayload, sanitizePayloadStrings } = require('./shared');
const { normalizeTenantId, matchesTenant } = require('./tenantService');
const analyticsService = require('./analyticsService');
const seoService = require('./seoService');
const contentPageService = require('./contentPageService');
const inventoryService = require('./inventoryService');
const config = require('../config');

function safe(value) {
  return escapeOutputPayload(value);
}

function ensureControlShape() {
  datasets.aiControl.providers = datasets.aiControl.providers || [];
  datasets.aiControl.agents = datasets.aiControl.agents || [];
  datasets.aiControl.observations = datasets.aiControl.observations || [];
  datasets.aiControl.webFetches = datasets.aiControl.webFetches || [];
  datasets.aiControl.voiceSettings = datasets.aiControl.voiceSettings || [];
  datasets.aiControl.assistantSessions = datasets.aiControl.assistantSessions || [];
}

function registerProvider(payload, tenantId) {
  ensureControlShape();
  const sanitized = sanitizePayloadStrings(payload, ['name', 'provider', 'model', 'apiBase', 'note']);
  const provider = {
    id: randomUUID(),
    tenantId: normalizeTenantId(tenantId),
    name: sanitized.name || 'AI Provider',
    provider: sanitized.provider || 'custom',
    model: sanitized.model || 'general',
    apiBase: sanitized.apiBase,
    note: sanitized.note,
    createdAt: new Date().toISOString()
  };
  datasets.aiControl.providers.push(provider);
  persist.aiControl(datasets.aiControl);
  return { provider: safe(provider) };
}

function listProviders(tenantId) {
  ensureControlShape();
  const tenant = normalizeTenantId(tenantId);
  return datasets.aiControl.providers.filter(provider => matchesTenant(provider.tenantId, tenant)).map(safe);
}

function recordObservation(payload, tenantId) {
  ensureControlShape();
  const sanitized = sanitizePayloadStrings(payload, ['kind', 'message', 'resourceType', 'resourceId']);
  const observation = {
    id: randomUUID(),
    tenantId: normalizeTenantId(tenantId),
    kind: sanitized.kind || 'system',
    message: sanitized.message,
    resourceType: sanitized.resourceType,
    resourceId: sanitized.resourceId,
    createdAt: new Date().toISOString()
  };
  datasets.aiControl.observations.push(observation);
  persist.aiControl(datasets.aiControl);
  return { observation: safe(observation) };
}

function aiSuggestions(tenantId) {
  ensureControlShape();
  const tenant = normalizeTenantId(tenantId);
  const dashboard = analyticsService.dashboard(tenant);
  const missingSeo = seoService.autofillMissing(tenant).generated;
  const pages = contentPageService.list({}, tenant) || [];
  const layoutsMissing = pages.filter(page => !datasets.pageLayouts.find(layout => layout.pageId === page.id));
  const inventory = inventoryService.list({}, tenant).items || [];
  const staleInventory = inventory.filter(item => !item.updatedAt || Date.now() - Date.parse(item.updatedAt) > 1000 * 60 * 60 * 24 * 30);

  const suggestions = [];
  if (missingSeo.length) {
    suggestions.push({
      type: 'seo',
      title: 'Autofill missing SEO profiles',
      impact: 'visibility',
      action: `Generate ${missingSeo.length} SEO records for inventory and pages lacking coverage.`,
      references: missingSeo.slice(0, 5)
    });
  }
  if (layoutsMissing.length) {
    suggestions.push({
      type: 'content',
      title: 'Design layouts for orphan pages',
      impact: 'engagement',
      action: `Create rich layouts for ${layoutsMissing.length} pages without structured blocks.`
    });
  }
  if (dashboard.inventoryPerformance.length) {
    const hero = dashboard.inventoryPerformance[0];
    suggestions.push({
      type: 'inventory',
      title: 'Promote top-performing unit',
      impact: 'revenue',
      action: `Feature ${hero.name} (${hero.stockNumber}) due to ${hero.leads} leads and ${hero.avgRating.toFixed(
        1
      )}★ rating.`,
      references: [hero]
    });
  }
  if (staleInventory.length) {
    suggestions.push({
      type: 'data_quality',
      title: 'Refresh stale inventory records',
      impact: 'trust',
      action: `${staleInventory.length} units have not been updated in 30+ days.`
    });
  }

  return { suggestions: suggestions.map(safe) };
}

async function performWebFetch(url, tenantId, note) {
  ensureControlShape();
  const entry = {
    id: randomUUID(),
    tenantId: normalizeTenantId(tenantId),
    url,
    note,
    status: 'queued',
    createdAt: new Date().toISOString()
  };
  datasets.aiControl.webFetches.push(entry);
  persist.aiControl(datasets.aiControl);

  if (!config.ai?.enableWebFetch) {
    const disabled = { ...entry, status: 'disabled', reason: 'Remote fetching is disabled by configuration' };
    datasets.aiControl.webFetches[datasets.aiControl.webFetches.length - 1] = disabled;
    persist.aiControl(datasets.aiControl);
    return { fetch: safe(disabled) };
  }

  if (typeof fetch !== 'function') {
    const unsupported = { ...entry, status: 'failed', error: 'Fetch API not available in this runtime' };
    datasets.aiControl.webFetches[datasets.aiControl.webFetches.length - 1] = unsupported;
    persist.aiControl(datasets.aiControl);
    return { fetch: safe(unsupported) };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(config.ai.fetchTimeoutMs || 7000));
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Sewell-AI/1.0' } });
    clearTimeout(timeout);
    const text = await response.text();
    const fetchResult = {
      ...entry,
      status: 'completed',
      httpStatus: response.status,
      preview: text.slice(0, 2000),
      contentLength: text.length,
      completedAt: new Date().toISOString()
    };
    datasets.aiControl.webFetches[datasets.aiControl.webFetches.length - 1] = fetchResult;
    persist.aiControl(datasets.aiControl);
    return { fetch: safe(fetchResult) };
  } catch (err) {
    const failed = { ...entry, status: 'failed', error: err.message, completedAt: new Date().toISOString() };
    datasets.aiControl.webFetches[datasets.aiControl.webFetches.length - 1] = failed;
    persist.aiControl(datasets.aiControl);
    return { fetch: safe(failed) };
  }
}

function listWebFetches(tenantId) {
  ensureControlShape();
  const tenant = normalizeTenantId(tenantId);
  return datasets.aiControl.webFetches.filter(entry => matchesTenant(entry.tenantId, tenant)).map(safe);
}

module.exports = {
  registerProvider,
  listProviders,
  recordObservation,
  aiSuggestions,
  performWebFetch,
  listWebFetches,
  ensureControlShape
};
