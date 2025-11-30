const { randomUUID } = require('node:crypto');
const aiService = require('./aiService');
const aiRegistryService = require('./aiRegistryService');
const inventoryService = require('./inventoryService');
const taskService = require('./taskService');
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

function seedPreferredProviders(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const seeded = aiRegistryService.seedDefaults(tenant);
  if (seeded) {
    persist.aiControl(datasets.aiControl);
  }
}

function defaultVoiceSettings(tenantId) {
  return {
    tenantId: normalizeTenantId(tenantId),
    enabled: false,
    playbackEnabled: false,
    micEnabled: false,
    voiceName: 'DealerGuide',
    sttProvider: 'gemini',
    ttsProvider: 'none',
    updatedAt: new Date().toISOString()
  };
}

function getVoiceSettings(tenantId) {
  ensureControlShape();
  seedPreferredProviders(tenantId);
  const tenant = normalizeTenantId(tenantId);
  const found = datasets.aiControl.voiceSettings.find(entry => matchesTenant(entry.tenantId, tenant));
  return safe(found || defaultVoiceSettings(tenant));
}

function setVoiceSettings(payload, tenantId) {
  ensureControlShape();
  const sanitized = sanitizePayloadStrings(payload, ['voiceName', 'surface', 'entrypoint', 'sttProvider', 'ttsProvider']);
  const tenant = normalizeTenantId(tenantId);
  const existingIndex = datasets.aiControl.voiceSettings.findIndex(entry => matchesTenant(entry.tenantId, tenant));
  const next = {
    ...defaultVoiceSettings(tenant),
    ...sanitized,
    tenantId: tenant,
    enabled: payload.enabled ?? false,
    playbackEnabled: payload.playbackEnabled ?? false,
    micEnabled: payload.micEnabled ?? false,
    sttProvider: sanitized.sttProvider || defaultVoiceSettings(tenant).sttProvider,
    ttsProvider: sanitized.ttsProvider || defaultVoiceSettings(tenant).ttsProvider,
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

function assistantStatus(tenantId, userRole) {
  ensureControlShape();
  seedPreferredProviders(tenantId);
  const tenant = normalizeTenantId(tenantId);
  const voice = getVoiceSettings(tenant);
  const sessions = datasets.aiControl.assistantSessions.filter(session => matchesTenant(session.tenantId, tenant));
  const pendingVehicles = sessions
    .filter(session => session.pendingVehicle && Object.keys(session.pendingVehicle).length)
    .map(session => ({ sessionId: session.id, ...session.pendingVehicle }));
  const automation = datasets.aiControl.automationPlans
    .filter(plan => matchesTenant(plan.tenantId, tenant))
    .slice(-5)
    .map(plan => ({
      id: plan.id,
      name: plan.name,
      status: plan.status,
      stepsCompleted: (plan.steps || []).filter(step => step.status === 'completed').length,
      stepsTotal: (plan.steps || []).length,
      updatedAt: plan.updatedAt
    }));

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
      },
      {
        id: 'task_runner',
        status: 'ready',
      description: 'AI can queue, track, and finish ordered task stacks.'
    }
  ],
  activeSessions: sessions.length,
  pendingVehicles,
  toolkit: getToolkit(tenant, { role: userRole }),
  automation
});
}

function getToolkit(tenantId, options = {}) {
  ensureControlShape();
  seedPreferredProviders(tenantId);
  const providers = aiRegistryService.listProviders(tenantId) || [];
  const tools = aiRegistryService.listTools({
    tenantId,
    profileIds: options.profileIds,
    role: options.role
  });
  return {
    models: providers.map(entry => ({
      id: entry.id || entry.provider,
      label: entry.name || entry.provider,
      purpose: entry.note || entry.capabilities?.join(', '),
      surfaces: entry.surfaces || ['chat', 'voice'],
      type: entry.type,
      defaultModel: entry.defaultModel || entry.model,
      capabilities: entry.capabilities
    })),
    tools,
    toolProfiles: aiRegistryService.listToolProfiles(tenantId),
    agents: aiRegistryService.listAgents(tenantId)
  };
}

function prepareAgentCall(agentId, payload = {}, tenantId) {
  ensureControlShape();
  seedPreferredProviders(tenantId);
  const promptPackage = aiRegistryService.buildPromptPackage(agentId, {
    tenantId,
    context: payload.context,
    user: payload.user,
    subPrompt: payload.subPrompt || payload.message
  });
  if (promptPackage.error) return { error: promptPackage.error };
  if (!promptPackage.provider) return { error: 'Provider not configured for agent' };

  const providerRequest = aiService.buildProviderRequest(promptPackage.provider, {
    prompt: promptPackage.prompt,
    tools: promptPackage.tools,
    model: payload.model,
    userMessage: payload.message || payload.subPrompt
  });
  const fallbackRequest =
    promptPackage.fallbackProvider &&
    aiService.buildProviderRequest(promptPackage.fallbackProvider, {
      prompt: promptPackage.prompt,
      tools: promptPackage.tools,
      model: payload.model,
      userMessage: payload.message || payload.subPrompt
    });

  return {
    promptPackage,
    providerRequest,
    fallbackRequest
  };
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

function recordToolUse(toolId, sessionId, tenantId, inputSummary) {
  ensureControlShape();
  const entry = {
    id: randomUUID(),
    tenantId: normalizeTenantId(tenantId),
    sessionId,
    toolId,
    input: inputSummary,
    at: new Date().toISOString()
  };
  datasets.aiControl.toolUseLog.push(entry);
  persist.aiControl(datasets.aiControl);
}

function normalizeTaskList(taskList = []) {
  return taskList
    .filter(Boolean)
    .map(entry => {
      if (typeof entry === 'string') return { title: entry };
      const sanitized = sanitizePayloadStrings(entry, ['title', 'notes']);
      return { title: sanitized.title, notes: sanitized.notes, autoComplete: entry.autoComplete };
    })
    .filter(entry => entry.title);
}

function buildAutomationPlan(taskList, tenantId, sessionId, name) {
  ensureControlShape();
  const normalizedTasks = normalizeTaskList(taskList);
  if (!normalizedTasks.length) {
    return { error: 'No tasks provided' };
  }

  const tenant = normalizeTenantId(tenantId);
  const now = new Date().toISOString();
  const steps = [];
  normalizedTasks.forEach((task, index) => {
    const creation = taskService.create(
      {
        title: task.title,
        notes: task.notes || 'AI queued task',
        assignedTo: 'ai-assistant',
        status: task.autoComplete === false ? 'open' : 'in_progress'
      },
      tenant
    );
    if (creation.error || !creation.task) return;

    const step = {
      order: index + 1,
      taskId: creation.task.id,
      title: creation.task.title,
      notes: task.notes,
      status: 'queued'
    };

    if (task.autoComplete !== false) {
      taskService.update(creation.task.id, { status: 'completed', notes: creation.task.notes }, tenant);
      step.status = 'completed';
      step.completedAt = new Date(Date.now() + index).toISOString();
    }

    steps.push(step);
  });

  const plan = {
    id: randomUUID(),
    tenantId: tenant,
    sessionId,
    name: name || 'AI automation run',
    steps,
    status: steps.every(step => step.status === 'completed') ? 'completed' : 'queued',
    createdAt: now,
    updatedAt: now
  };

  datasets.aiControl.automationPlans.push(plan);
  persist.aiControl(datasets.aiControl);
  recordToolUse('tool.tasks.flow', sessionId, tenant, name || 'task automation');
  return { plan: safe(plan) };
}

function listAutomationPlans(tenantId) {
  ensureControlShape();
  const tenant = normalizeTenantId(tenantId);
  return datasets.aiControl.automationPlans.filter(plan => matchesTenant(plan.tenantId, tenant)).map(safe);
}

function taskSnapshot(tenantId) {
  const tasks = taskService.list({}, tenantId);
  const totals = tasks.reduce(
    (agg, task) => {
      agg[task.status] = (agg[task.status] || 0) + 1;
      return agg;
    },
    { open: 0, in_progress: 0, completed: 0, canceled: 0 }
  );
  return { totals, sample: tasks.slice(-5) };
}

function inspectSourceOverview() {
  return {
    message: 'AI can inspect backend modules before proposing edits.',
    surfaces: [
      { path: 'src/services', purpose: 'business logic + AI orchestration' },
      { path: 'src/validation', purpose: 'input schemas to guard AI writes' },
      { path: 'src/middleware', purpose: 'security, auth, and CSRF checks' },
      { path: 'public', purpose: 'frontend assets exposed to AI entrypoint' }
    ]
  };
}

function startSession(payload, tenantId) {
  ensureControlShape();
  const tenant = normalizeTenantId(payload.tenantId || tenantId);
  const sanitized = sanitizePayloadStrings(payload, ['entrypoint', 'channel', 'surface', 'agentId']);
  const now = new Date().toISOString();
  const initialVehicle = normalizeVehicleDraft(payload.vehicleDraft);
  const agentId = sanitized.agentId || 'global-assistant';
  const agent = prepareAgentCall(agentId, { context: payload.context }, tenant)?.promptPackage?.agent;
  const session = {
    id: randomUUID(),
    tenantId: tenant,
    channel: sanitized.channel === 'voice' ? 'voice' : 'chat',
    entrypoint: sanitized.entrypoint || 'floating-icon',
    voiceEnabled: payload.voiceEnabled ?? getVoiceSettings(tenant).enabled,
    micEnabled: payload.micEnabled ?? getVoiceSettings(tenant).micEnabled,
    operatingProfile: getToolkit(tenant),
    createdAt: now,
    updatedAt: now,
    pendingVehicle: Object.keys(initialVehicle).length ? initialVehicle : null,
    agentId,
    context: payload.context || {},
    transcript: []
  };
  datasets.aiControl.assistantSessions.push(session);
  persist.aiControl(datasets.aiControl);
  const greeting = {
    id: randomUUID(),
    from: 'assistant',
    message:
      'Ready to help with backend tasks, chat or voice. Using Gemini 3 Pro (OpenAI backup) with the full dealer toolkit.',
    at: now
  };
  session.transcript.push(greeting);
  persist.aiControl(datasets.aiControl);
  const toolkit = getToolkit(tenant, { role: payload.userRole });
  return {
    session: safeSession(session),
    greeting: safe(greeting),
    agent: safe(agent || {}),
    toolkit: safe(toolkit)
  };
}

function appendTranscript(session, entry) {
  session.transcript = session.transcript || [];
  session.transcript.push(entry);
}

function resolveAgentId(session, payloadAgentId) {
  return payloadAgentId || session.agentId || 'global-assistant';
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

function buildSuggestedActions(session, payload) {
  const actions = [];
  const ctx = { ...session.context, ...(payload.context || {}) };

  if (ctx.inventoryId) {
    actions.push({
      id: 'enrich_inventory_specs',
      label: 'Enrich specs for this unit',
      description: 'Fetch trusted specs and propose a minimal patch.',
      toolCalls: [
        {
          tool: 'ai_web_fetch',
          args: {
            url: 'https://manufacturer.com',
            purpose: `Look up specs for inventory ${ctx.inventoryId}`
          }
        },
        {
          tool: 'update_inventory_specs',
          args: {
            id: ctx.inventoryId,
            patch: { note: 'Proposed updates after fetch' }
          }
        }
      ],
      requiresConfirmation: true
    });
  }

  if (ctx.leadId) {
    actions.push({
      id: 'lead_follow_up',
      label: 'Plan follow-up for lead',
      description: 'Summarize intent and create a follow-up task.',
      toolCalls: [
        { tool: 'get_lead_detail', args: { id: ctx.leadId } },
        { tool: 'get_lead_timeline', args: { id: ctx.leadId } },
        { tool: 'create_task', args: { title: `Follow up with lead ${ctx.leadId}` } }
      ],
      requiresConfirmation: true
    });
  }

  return actions;
}

function handleTaskFlow(session, payload, tenantId) {
  const tasks = normalizeTaskList(payload.tasks || []);
  if (tasks.length) {
    const built = buildAutomationPlan(tasks, tenantId, session.id, payload.planName || payload.message);
    if (built.error) {
      return { message: built.error, intent: 'task_runner' };
    }
    return {
      intent: 'task_runner',
      plan: built.plan,
      message: `Queued ${tasks.length} ordered tasks. Status: ${built.plan.status}.`
    };
  }

  const snapshot = taskSnapshot(tenantId);
  return {
    intent: 'task_runner',
    message: `Tasks now: open ${snapshot.totals.open}, in_progress ${snapshot.totals.in_progress}, completed ${snapshot.totals.completed}.`,
    tasks: snapshot.sample
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
    agentId: resolveAgentId(session, payload.agentId),
    context: payload.context,
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
    recordToolUse('tool.inventory.add', sessionId, session.tenantId, sanitized.message || 'vehicle add');
  } else if (sanitized.intent === 'task_runner' || (sanitized.message || '').toLowerCase().includes('task')) {
    const result = handleTaskFlow(session, payload, tenantId);
    reply = { ...reply, ...result };
  } else if (sanitized.intent === 'toolkit' || (sanitized.message || '').toLowerCase().includes('tool')) {
    reply.intent = 'toolkit';
    reply.message = 'Toolkit ready with ChatGPT and Gemini models plus dealer tools.';
    reply.toolkit = getToolkit(tenantId);
  } else if (sanitized.intent === 'inspect_code' || (sanitized.message || '').toLowerCase().includes('source')) {
    reply.intent = 'inspect_code';
    reply.message = 'Here are the backend surfaces I can review before proposing edits.';
    reply.inspect = inspectSourceOverview();
    recordToolUse('tool.code.introspect', sessionId, session.tenantId, 'surface overview');
  } else {
    reply.message =
      'AI assistant is active across the backend. I can sweep the web, run tasks, analyze data, and prep updates—what should I tackle?';
  }

  const agentId = resolveAgentId(session, payload.agentId);
  const agentCall = prepareAgentCall(
    agentId,
    {
      context: payload.context || session.context,
      user: { role: payload.userRole },
      message: sanitized.message
    },
    session.tenantId
  );
  if (!agentCall.error) {
    reply.agent = {
      id: agentId,
      providerRequest: agentCall.providerRequest,
      fallbackRequest: agentCall.fallbackRequest,
      promptPackage: agentCall.promptPackage
    };
    reply.suggestedActions = buildSuggestedActions(session, payload);
  } else {
    reply.agentError = agentCall.error;
  }

  session.updatedAt = now;
  session.agentId = agentId;
  session.context = { ...session.context, ...payload.context };
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
  ensureControlShape,
  getToolkit,
  prepareAgentCall,
  listAutomationPlans,
  buildAutomationPlan
};
