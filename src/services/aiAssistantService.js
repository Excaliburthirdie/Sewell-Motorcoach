const { randomUUID } = require('node:crypto');
const aiService = require('./aiService');
const inventoryService = require('./inventoryService');
const { datasets, persist } = require('./state');
const { escapeOutputPayload, sanitizePayloadStrings } = require('./shared');
const { normalizeTenantId, matchesTenant } = require('./tenantService');

function safe(value) {
  return escapeOutputPayload(value);
}

function ensureControlShape() {
  aiService.ensureControlShape?.();
  datasets.aiControl.providers = datasets.aiControl.providers || [];
  datasets.aiControl.agents = datasets.aiControl.agents || [];
  datasets.aiControl.observations = datasets.aiControl.observations || [];
  datasets.aiControl.webFetches = datasets.aiControl.webFetches || [];
  datasets.aiControl.voiceSettings = datasets.aiControl.voiceSettings || [];
  datasets.aiControl.assistantSessions = datasets.aiControl.assistantSessions || [];
}

function defaultVoiceSettings(tenantId) {
  return {
    tenantId: normalizeTenantId(tenantId),
    enabled: false,
    playbackEnabled: false,
    micEnabled: false,
    voiceName: 'DealerGuide',
    updatedAt: new Date().toISOString()
  };
}

function getVoiceSettings(tenantId) {
  ensureControlShape();
  const tenant = normalizeTenantId(tenantId);
  const found = datasets.aiControl.voiceSettings.find(entry => matchesTenant(entry.tenantId, tenant));
  return safe(found || defaultVoiceSettings(tenant));
}

function setVoiceSettings(payload, tenantId) {
  ensureControlShape();
  const sanitized = sanitizePayloadStrings(payload, ['voiceName', 'surface', 'entrypoint']);
  const tenant = normalizeTenantId(tenantId);
  const existingIndex = datasets.aiControl.voiceSettings.findIndex(entry => matchesTenant(entry.tenantId, tenant));
  const next = {
    ...defaultVoiceSettings(tenant),
    ...sanitized,
    tenantId: tenant,
    enabled: payload.enabled ?? false,
    playbackEnabled: payload.playbackEnabled ?? false,
    micEnabled: payload.micEnabled ?? false,
    updatedAt: new Date().toISOString()
  };
  if (existingIndex >= 0) {
    datasets.aiControl.voiceSettings[existingIndex] = next;
  } else {
    datasets.aiControl.voiceSettings.push(next);
  }
  persist.aiControl(datasets.aiControl);
  return safe(next);
}

function assistantStatus(tenantId) {
  ensureControlShape();
  const tenant = normalizeTenantId(tenantId);
  const voice = getVoiceSettings(tenant);
  const sessions = datasets.aiControl.assistantSessions.filter(session => matchesTenant(session.tenantId, tenant));
  const pendingVehicles = sessions
    .filter(session => session.pendingVehicle && Object.keys(session.pendingVehicle).length)
    .map(session => ({ sessionId: session.id, ...session.pendingVehicle }));

  return safe({
    tenantId: tenant,
    voice,
    chatEntrypoint: {
      position: 'bottom-right',
      icon: 'sparkle-ai',
      label: 'AI Control'
    },
    capabilities: [
      {
        id: 'inventory_voice_add',
        status: voice.enabled ? 'ready' : 'needs_voice',
        description: 'Capture spoken inventory adds then request missing details.'
      },
      {
        id: 'web_sweeps',
        status: 'scheduled',
        description: 'Background web sweeps run via AI web fetch requests.'
      },
      {
        id: 'self_edit',
        status: 'review',
        description: 'Assistant can request source files for inspection before edits.'
      }
    ],
    activeSessions: sessions.length,
    pendingVehicles
  });
}

function normalizeVehicleDraft(draft = {}) {
  const sanitized = sanitizePayloadStrings(draft, ['stockNumber', 'vin', 'name', 'condition', 'category', 'industry']);
  const numericFields = ['price', 'msrp', 'salePrice', 'rebates', 'fees', 'taxes', 'year', 'length', 'weight'];
  const normalized = { ...sanitized };
  numericFields.forEach(field => {
    if (draft[field] !== undefined) {
      const asNumber = Number(draft[field]);
      if (!Number.isNaN(asNumber)) {
        normalized[field] = asNumber;
      }
    }
  });
  if (!normalized.name && sanitized.year && sanitized.category) {
    normalized.name = `${sanitized.year} ${sanitized.category}`.trim();
  }
  return normalized;
}

function parseVehicleFromMessage(message = '') {
  const lower = message.toLowerCase();
  const draft = {};
  const vinMatch = message.match(/vin\s*([a-z0-9]{11,17})/i);
  if (vinMatch) draft.vin = vinMatch[1].toUpperCase();
  const stockMatch = message.match(/stock(?: number)?\s*([a-z0-9-]+)/i);
  if (stockMatch) draft.stockNumber = stockMatch[1];
  const priceMatch = message.match(/\$?([0-9]{2,}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/);
  if (priceMatch) draft.price = Number(priceMatch[1].replace(/,/g, ''));
  if (lower.includes('used')) draft.condition = 'used';
  if (lower.includes('new')) draft.condition = draft.condition || 'new';
  const yearMatch = message.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearMatch) draft.year = Number(yearMatch[1]);
  return draft;
}

function requiredVehicleFields() {
  return ['stockNumber', 'vin', 'name', 'condition', 'price'];
}

function mergeVehicleDetails(existing = {}, incoming = {}) {
  return { ...existing, ...incoming };
}

function computeMissingVehicleFields(vehicleDraft) {
  return requiredVehicleFields().filter(field => vehicleDraft[field] === undefined || vehicleDraft[field] === '');
}

function safeSession(session) {
  return safe({
    ...session,
    transcript: (session.transcript || []).slice(-20)
  });
}

function startSession(payload, tenantId) {
  ensureControlShape();
  const tenant = normalizeTenantId(payload.tenantId || tenantId);
  const sanitized = sanitizePayloadStrings(payload, ['entrypoint', 'channel', 'surface']);
  const now = new Date().toISOString();
  const initialVehicle = normalizeVehicleDraft(payload.vehicleDraft);
  const session = {
    id: randomUUID(),
    tenantId: tenant,
    channel: sanitized.channel === 'voice' ? 'voice' : 'chat',
    entrypoint: sanitized.entrypoint || 'floating-icon',
    voiceEnabled: payload.voiceEnabled ?? getVoiceSettings(tenant).enabled,
    micEnabled: payload.micEnabled ?? getVoiceSettings(tenant).micEnabled,
    createdAt: now,
    updatedAt: now,
    pendingVehicle: Object.keys(initialVehicle).length ? initialVehicle : null,
    transcript: []
  };
  datasets.aiControl.assistantSessions.push(session);
  persist.aiControl(datasets.aiControl);
  const greeting = {
    id: randomUUID(),
    from: 'assistant',
    message: 'Ready to help with backend tasks, chat or voice.',
    at: now
  };
  session.transcript.push(greeting);
  persist.aiControl(datasets.aiControl);
  return { session: safeSession(session), greeting: safe(greeting) };
}

function appendTranscript(session, entry) {
  session.transcript = session.transcript || [];
  session.transcript.push(entry);
}

function handleVehicleDraft(session, payload) {
  const extracted = parseVehicleFromMessage(payload.message || '');
  const merged = mergeVehicleDetails(session.pendingVehicle || {}, normalizeVehicleDraft(payload.vehicleDraft || {}));
  session.pendingVehicle = mergeVehicleDetails(merged, extracted);
  const missing = computeMissingVehicleFields(session.pendingVehicle || {});

  if (missing.length === 0) {
    const creation = inventoryService.create(session.pendingVehicle, session.tenantId);
    if (creation.error) {
      return {
        message: `I couldn't add the vehicle yet: ${creation.error}`,
        missingFields: [],
        completed: false
      };
    }
    session.pendingVehicle = null;
    return {
      message: `Added ${creation.unit.name} (${creation.unit.stockNumber}) with AI assistance.`,
      missingFields: [],
      completed: true
    };
  }

  return {
    message: `I captured the request. Please confirm: ${missing.join(', ')}.`,
    missingFields: missing,
    completed: false
  };
}

function sendMessage(sessionId, payload, tenantId) {
  ensureControlShape();
  const session = datasets.aiControl.assistantSessions.find(
    entry => entry.id === sessionId && matchesTenant(entry.tenantId, tenantId)
  );
  if (!session) return { notFound: true };

  const sanitized = sanitizePayloadStrings(payload, ['message', 'intent']);
  const now = new Date().toISOString();
  appendTranscript(session, {
    id: randomUUID(),
    from: 'user',
    message: sanitized.message,
    micActive: !!payload.micActive,
    at: now
  });

  let reply = {
    id: randomUUID(),
    from: 'assistant',
    at: now
  };

  if (
    sanitized.intent === 'add_vehicle' ||
    payload.vehicleDraft ||
    (sanitized.message || '').toLowerCase().includes('add vehicle')
  ) {
    const result = handleVehicleDraft(session, payload);
    reply.message = result.message;
    reply.missingFields = result.missingFields;
    reply.pendingVehicle = session.pendingVehicle;
    reply.intent = 'add_vehicle';
  } else {
    reply.message =
      'AI assistant is active across the backend. I can sweep the web, analyze data, and prep updates—what should I tackle?';
  }

  session.updatedAt = now;
  appendTranscript(session, reply);
  persist.aiControl(datasets.aiControl);
  return { session: safeSession(session), response: safe(reply) };
}

module.exports = {
  assistantStatus,
  getVoiceSettings,
  setVoiceSettings,
  startSession,
  sendMessage,
  ensureControlShape
};
