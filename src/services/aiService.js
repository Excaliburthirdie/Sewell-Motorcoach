const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { escapeOutputPayload, sanitizePayloadStrings } = require('./shared');
const { normalizeTenantId, matchesTenant } = require('./tenantService');
const analyticsService = require('./analyticsService');
const seoService = require('./seoService');
const contentPageService = require('./contentPageService');
const inventoryService = require('./inventoryService');
const aiRegistryService = require('./aiRegistryService');
const config = require('../config');

const fetchRateBuckets = new Map(); // tenantId -> timestamps array

function safe(value) {
  return escapeOutputPayload(value);
}

function ensureControlShape() {
  datasets.aiControl.providers = datasets.aiControl.providers || [];
  datasets.aiControl.agents = datasets.aiControl.agents || [];
  datasets.aiControl.toolRegistry = datasets.aiControl.toolRegistry || [];
  datasets.aiControl.toolProfiles = datasets.aiControl.toolProfiles || [];
  datasets.aiControl.observations = datasets.aiControl.observations || [];
  datasets.aiControl.webFetches = datasets.aiControl.webFetches || [];
  datasets.aiControl.voiceSettings = datasets.aiControl.voiceSettings || [];
  datasets.aiControl.assistantSessions = datasets.aiControl.assistantSessions || [];
  datasets.aiControl.toolUseLog = datasets.aiControl.toolUseLog || [];
  datasets.aiControl.automationPlans = datasets.aiControl.automationPlans || [];
  datasets.aiControl.autopilotSettings = datasets.aiControl.autopilotSettings || [];
}

function registerProvider(payload, tenantId) {
  ensureControlShape();
  const sanitized = sanitizePayloadStrings(payload, [
    'id',
    'name',
    'provider',
    'type',
    'model',
    'defaultModel',
    'apiBase',
    'baseUrl',
    'note'
  ]);
  const tenant = normalizeTenantId(tenantId);
  const capabilities = Array.isArray(payload.capabilities)
    ? payload.capabilities.map(entry => String(entry)).filter(Boolean)
    : undefined;
  const surfaces = Array.isArray(payload.surfaces)
    ? payload.surfaces.map(entry => String(entry)).filter(Boolean)
    : undefined;

  const provider = {
    id: sanitized.id || randomUUID(),
    tenantId: tenant,
    name: sanitized.name || 'AI Provider',
    provider: sanitized.provider || sanitized.id || 'custom',
    type: sanitized.type || payload.type || 'custom',
    defaultModel: sanitized.defaultModel || sanitized.model || 'general',
    model: sanitized.model || sanitized.defaultModel || 'general',
    baseUrl: sanitized.baseUrl || sanitized.apiBase,
    apiBase: sanitized.apiBase,
    capabilities,
    surfaces,
    note: sanitized.note,
    createdAt: new Date().toISOString()
  };
  datasets.aiControl.providers.push(provider);
  persist.aiControl(datasets.aiControl);
  return { provider: safe(provider) };
}

function listProviders(tenantId) {
  ensureControlShape();
  return aiRegistryService.listProviders(tenantId);
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

async function performWebFetch(payload, tenantId, note) {
  ensureControlShape();
  const incoming = typeof payload === 'string' ? { url: payload, note } : payload || {};
  const sanitized = sanitizePayloadStrings(incoming, ['url', 'note', 'purpose']);
  const maxBytes = incoming.maxBytes ? Number(incoming.maxBytes) : undefined;
  const tenant = normalizeTenantId(tenantId);
  let hostname = '';
  try {
    hostname = new URL(sanitized.url).hostname.toLowerCase();
  } catch (err) {
    const invalid = {
      id: randomUUID(),
      tenantId: tenant,
      url: sanitized.url,
      note: sanitized.note,
      purpose: sanitized.purpose,
      status: 'failed',
      error: 'Invalid URL',
      createdAt: new Date().toISOString()
    };
    datasets.aiControl.webFetches.push(invalid);
    persist.aiControl(datasets.aiControl);
    return { fetch: safe(invalid) };
  }

  // Allowlist guard (supports wildcard "*")
  const allowedDomains = config.ai.fetchAllowlist || [];
  const allowAll = allowedDomains.includes('*');
  const domainAllowed =
    allowAll || allowedDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));

  if (!domainAllowed) {
    const blocked = {
      id: randomUUID(),
      tenantId: tenant,
      url: sanitized.url,
      note: sanitized.note,
      purpose: sanitized.purpose,
      status: 'blocked',
      error: 'Domain not in allowlist',
      createdAt: new Date().toISOString(),
      domain: hostname
    };
    datasets.aiControl.webFetches.push(blocked);
    persist.aiControl(datasets.aiControl);
    return { fetch: safe(blocked) };
  }

  // Rate limit per tenant
  const nowTs = Date.now();
  const windowMs = 60 * 1000;
  const maxPerMinute = Number(config.ai.fetchPerTenantPerMinute || 10);
  const bucket = fetchRateBuckets.get(tenant) || [];
  const recent = bucket.filter(ts => nowTs - ts < windowMs);
  if (recent.length >= maxPerMinute) {
    const limited = {
      id: randomUUID(),
      tenantId: tenant,
      url: sanitized.url,
      note: sanitized.note,
      purpose: sanitized.purpose,
      status: 'rate_limited',
      error: 'Web fetch rate limit exceeded',
      createdAt: new Date().toISOString(),
      domain: hostname
    };
    datasets.aiControl.webFetches.push(limited);
    persist.aiControl(datasets.aiControl);
    return { fetch: safe(limited) };
  }

  const entry = {
    id: randomUUID(),
    tenantId: tenant,
    url: sanitized.url,
    note: sanitized.note,
    purpose: sanitized.purpose,
    maxBytes: Number.isFinite(maxBytes) ? maxBytes : undefined,
    domain: hostname,
    status: 'queued',
    createdAt: new Date().toISOString()
  };
  datasets.aiControl.webFetches.push(entry);
  persist.aiControl(datasets.aiControl);
  fetchRateBuckets.set(tenant, [...recent, nowTs]);

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
    const response = await fetch(sanitized.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Sewell-AI/1.0' }
    });
    clearTimeout(timeout);
    const text = await response.text();
    const trimmed = entry.maxBytes ? text.slice(0, entry.maxBytes) : text;
    const fetchResult = {
      ...entry,
      status: 'completed',
      httpStatus: response.status,
      preview: trimmed.slice(0, 2000),
      contentLength: trimmed.length,
      rawLength: text.length,
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

function toolFunctions(tools = []) {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters || { type: 'object', properties: {} }
    }
  }));
}

function geminiFunctionDeclarations(tools = []) {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters || { type: 'object', properties: {} }
  }));
}

function buildOpenAiMessages(agentCall = {}) {
  const prompt = agentCall.prompt || {};
  const context = prompt.context || {};
  const userMessage = agentCall.userMessage || prompt.subPrompt || '';
  const guardrails = Array.isArray(prompt.guardrails) ? prompt.guardrails.join('\n') : prompt.guardrails;
  const playbook = prompt.playbook ? JSON.stringify(prompt.playbook) : '';
  const contextString = Object.keys(context || {}).length ? `Context: ${JSON.stringify(context)}` : '';
  const systemBlock = [prompt.system, guardrails, playbook].filter(Boolean).join('\n\n').trim();
  const messages = [];
  if (systemBlock) messages.push({ role: 'system', content: systemBlock });
  messages.push({ role: 'user', content: [userMessage, contextString].filter(Boolean).join('\n\n').trim() });
  return messages;
}

class BaseAiProviderClient {
  constructor(config = {}) {
    this.config = config;
  }

  buildToolSchema(tools) {
    return toolFunctions(tools);
  }
}

class OpenAiProviderClient extends BaseAiProviderClient {
  chatWithTools(agentCall = {}) {
    const model = agentCall.model || this.config.defaultModel || this.config.model || 'gpt-4.1';
    return {
      provider: this.config.id || this.config.provider,
      type: 'openai',
      url: `${this.config.baseUrl || 'https://api.openai.com/v1'}/chat/completions`,
      body: {
        model,
        messages: buildOpenAiMessages(agentCall),
        tools: this.buildToolSchema(agentCall.tools),
        tool_choice: 'auto',
        temperature: agentCall.temperature ?? 0.2
      }
    };
  }
}

class GeminiProviderClient extends BaseAiProviderClient {
  chatWithTools(agentCall = {}) {
    const model = agentCall.model || this.config.defaultModel || this.config.model || 'gemini-3-pro';
    const contents = buildOpenAiMessages(agentCall).map(message => ({
      role: message.role === 'system' ? 'model' : 'user',
      parts: [{ text: message.content }]
    }));

    return {
      provider: this.config.id || this.config.provider,
      type: 'gemini',
      url: `${this.config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta'}/models/${model}:generateContent`,
      body: {
        contents,
        tools: [{ functionDeclarations: geminiFunctionDeclarations(agentCall.tools) }]
      }
    };
  }
}

function buildProviderClient(providerConfig = {}) {
  if ((providerConfig.type || '').toLowerCase() === 'gemini') {
    return new GeminiProviderClient(providerConfig);
  }
  return new OpenAiProviderClient(providerConfig);
}

function buildProviderRequest(providerConfig = {}, agentCall = {}) {
  const client = buildProviderClient(providerConfig);
  return client.chatWithTools(agentCall);
}

module.exports = {
  registerProvider,
  listProviders,
  recordObservation,
  aiSuggestions,
  performWebFetch,
  listWebFetches,
  ensureControlShape,
  buildProviderClient,
  buildProviderRequest
};
