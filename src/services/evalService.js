const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { escapeOutputPayload, sanitizePayloadStrings } = require('./shared');
const { normalizeTenantId, matchesTenant } = require('./tenantService');

function safe(value) {
  return escapeOutputPayload(value);
}

function ensureShape() {
  datasets.evals = datasets.evals || [];
}

function seedIfEmpty(tenantId) {
  ensureShape();
  const tenant = normalizeTenantId(tenantId);
  const existing = datasets.evals.filter(entry => matchesTenant(entry.tenantId, tenant));
  if (existing.length) return;
  const now = new Date().toISOString();
  const seed = baseCatalog().map(entry => ({
    ...entry,
    tenantId: tenant,
    createdAt: now,
    updatedAt: now,
    createdBy: 'seed'
  }));
  datasets.evals.push(...seed);
  persist.evals(datasets.evals);
}

function baseCatalog() {
  return [
    // System / AI
    {
      id: 'system_self_test',
      name: 'System Self-Test',
      category: 'system',
      description: 'Run smoke tests across APIs, tools, and data integrity.',
      examples: ['Run a self test', 'Check the system health', 'Perform diagnostics'],
      inputsSchema: { type: 'object', properties: {} },
      playbook:
        'Run API smoke tests, validate tool definitions vs routes, check health/metrics, and summarize issues. Never change production data. Steps: 1) call health/metrics; 2) list tools vs routes; 3) run safe sample tool calls with test data; 4) report failures and likely causes.',
      restrictions: ['Never modify production data', 'Use test fixtures only for mutations'],
      tools: ['get_health', 'get_metrics', 'ai_tool_registry_management'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'daily_briefing',
      name: 'Daily Briefing',
      category: 'system',
      description: 'Summarize key inventory, leads, campaigns, issues, and market notes.',
      examples: ['Give me the daily briefing', 'What happened today?'],
      inputsSchema: {
        type: 'object',
        properties: { start: { type: 'string' }, end: { type: 'string' } }
      },
      playbook:
        'Gather inventory stats, lead highlights, tasks/notifications, campaign performance, analytics, and latest market update signals. Output structured sections for UI (inventory, leads/tasks, campaigns, analytics, market, issues). Read-only.',
      restrictions: ['Read-only', 'No outbound emails'],
      tools: ['analytics_dashboard', 'campaign_performance_report', 'list_leads'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'whats_next_autopilot',
      name: 'What\'s Next Autopilot',
      category: 'system',
      description: 'Pick the next best safe task to run when idle.',
      examples: ['What should we do next?', 'Run autopilot tasks'],
      inputsSchema: { type: 'object', properties: {} },
      playbook:
        'Review backlog, metrics, and pending items. Choose safe tasks allowed by autopilot level. Emit <COMMAND> blocks to trigger evals.',
      restrictions: ['Only autopilotLevel 1 unless tenant allows level 2'],
      tools: ['list_automation_plans', 'ai_web_fetch'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'market_update_scan',
      name: 'Market Update Scan',
      category: 'market',
      description: 'Scan competitor pricing, sentiment, SEO rankings, and market trends.',
      examples: ['Market update', 'Check competitors', 'Scan pricing'],
      inputsSchema: { type: 'object', properties: {} },
      playbook:
        'Fetch competitor listings, compute price/velocity, search sentiment, review SEO rankings, and output actionable insights. Include sections: competitor pricing, time-to-sell, arbitrage candidates, brand sentiment, SEO ranking issues with fixes. Read-only.',
      restrictions: ['Do not change pricing', 'No bulk writes'],
      tools: ['search_competitor_inventory', 'fetch_competitor_listing', 'ai_web_fetch'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'ai_architect',
      name: 'AI Architect',
      category: 'ai',
      description: 'Review evals and logs to propose improvements.',
      examples: ['Improve AI', 'Audit evals'],
      inputsSchema: { type: 'object', properties: {} },
      playbook: 'Read evals and logs, propose new evals or updates as drafts.',
      restrictions: ['Do not execute writes without approval'],
      tools: ['list_evals', 'ai_tool_registry_management'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    // Inventory
    {
      id: 'inventory_enrichment',
      name: 'Inventory Enrichment',
      category: 'inventory',
      description: 'Fill missing specs for inventory using trusted web sources.',
      examples: ['Fill missing specs', 'Enrich this unit'],
      inputsSchema: {
        type: 'object',
        properties: { inventoryId: { type: 'string' } },
        required: ['inventoryId']
      },
      playbook:
        'Load unit, find missing specs, fetch manufacturer/spec sources, update only with high-confidence data, log sources. Avoid price/VIN edits.',
      restrictions: ['Never change price or VIN', 'Log sources'],
      tools: ['get_inventory_unit', 'ai_web_fetch', 'update_inventory_specs'],
      autopilotLevel: 2,
      status: 'active',
      version: 1
    },
    {
      id: 'inventory_lookup',
      name: 'Inventory Lookup',
      category: 'inventory',
      description: 'Find or load a specific inventory unit.',
      examples: ['Find stock 123', 'Show unit by slug'],
      inputsSchema: {
        type: 'object',
        properties: { id: { type: 'string' }, slug: { type: 'string' }, query: { type: 'string' } }
      },
      playbook: 'Use get_inventory_unit or search_inventory. Return concise summary.',
      restrictions: ['Read-only'],
      tools: ['get_inventory_unit', 'search_inventory'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'inventory_search_and_filter',
      name: 'Inventory Search and Filter',
      category: 'inventory',
      description: 'Run filtered searches across inventory.',
      examples: ['Search units under 100k', 'Find Class A with bunk'],
      inputsSchema: { type: 'object', properties: { query: { type: 'string' } } },
      playbook: 'Apply filters and return a ranked list with reasoning; do not modify data.',
      restrictions: ['Read-only'],
      tools: ['search_inventory'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'inventory_story_edit',
      name: 'Inventory Story Edit',
      category: 'inventory',
      description: 'Rewrite or refine sales story for a unit.',
      examples: ['Rewrite the story', 'Improve listing copy'],
      inputsSchema: { type: 'object', properties: { inventoryId: { type: 'string' } } },
      playbook: 'Fetch unit, draft concise story, propose changes; require confirmation before writing.',
      restrictions: ['No price claims', 'Require confirmation for writes'],
      tools: ['get_inventory_unit', 'update_inventory_story'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'inventory_badge_management',
      name: 'Inventory Badge Management',
      category: 'inventory',
      description: 'Preview or recompute badges for inventory.',
      examples: ['Recompute badges', 'Preview badges for this unit'],
      inputsSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } } },
      playbook: 'Preview badge changes before bulk recompute; avoid heavy traffic times.',
      restrictions: ['Avoid frequent bulk recompute', 'Require confirmation for bulk'],
      tools: ['recompute_inventory_badges'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'inventory_display_config_management',
      name: 'Inventory Display Configuration',
      category: 'inventory',
      description: 'Manage which fields show in list/detail layouts and sorting.',
      examples: ['Configure inventory layout', 'Change list view fields'],
      inputsSchema: { type: 'object', properties: {} },
      playbook: 'Read current display config, propose safe changes, require confirmation for sweeping updates.',
      restrictions: ['Require confirmation for global layout changes'],
      tools: ['get_inventory_display_config', 'update_inventory_display_config'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    // Content / SEO
    {
      id: 'content_page_management',
      name: 'Content Page Management',
      category: 'content',
      description: 'Create or update content pages.',
      examples: ['Create a landing page', 'Update content page'],
      inputsSchema: { type: 'object', properties: { id: { type: 'string' } } },
      playbook: 'Fetch page, edit draft, avoid deleting without confirmation.',
      restrictions: ['Require confirmation for deletes'],
      tools: ['list_content_pages', 'get_content_page', 'update_content_page'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'page_layout_edit',
      name: 'Page Layout Edit',
      category: 'content',
      description: 'Manage page layout drafts and publish.',
      examples: ['Adjust homepage layout', 'Publish layout'],
      inputsSchema: { type: 'object', properties: { pageId: { type: 'string' } } },
      playbook: 'Load layout draft, propose block changes, publish when confirmed.',
      restrictions: ['Require confirmation before publish'],
      tools: ['get_page_layout', 'update_page_layout'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'seo_profile_management',
      name: 'SEO Profile Management',
      category: 'seo',
      description: 'Manage SEO profiles for content/inventory.',
      examples: ['Update SEO profile', 'Edit SEO'],
      inputsSchema: { type: 'object', properties: { resourceId: { type: 'string' } } },
      playbook: 'List profiles, edit target profile, avoid duplicate canonicals.',
      restrictions: ['Confirmation for mass updates'],
      tools: ['list_seo_profiles', 'autofill_seo_profile'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'seo_autofill_and_health',
      name: 'SEO Autofill and Health',
      category: 'seo',
      description: 'Autofill missing SEO and review health.',
      examples: ['Fix SEO', 'Autofill SEO'],
      inputsSchema: { type: 'object', properties: {} },
      playbook: 'Run seo_autofill, review health warnings, propose changes.',
      restrictions: ['Confirmation for mass updates'],
      tools: ['autofill_seo_profile', 'get_seo_health', 'list_seo_profiles'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'redirect_rules_management',
      name: 'Redirect Rules Management',
      category: 'seo',
      description: 'Manage redirect rules for the site.',
      examples: ['Add a redirect', 'List redirects'],
      inputsSchema: { type: 'object', properties: { sourcePath: { type: 'string' } } },
      playbook: 'List redirects, add or delete with confirmation, avoid loops.',
      restrictions: ['Confirmation for deletes'],
      tools: ['list_redirects', 'create_redirect', 'delete_redirect'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    // CRM / Ops
    {
      id: 'lead_management',
      name: 'Lead Management',
      category: 'crm',
      description: 'Update lead statuses and propose follow-ups.',
      examples: ['Update this lead', 'Prioritize leads'],
      inputsSchema: { type: 'object', properties: { leadId: { type: 'string' } } },
      playbook: 'Load lead detail and timeline, suggest next steps, create tasks when asked.',
      restrictions: ['Do not contact customers automatically'],
      tools: ['list_leads', 'get_lead_detail', 'get_lead_timeline', 'update_lead_status', 'create_task'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'lead_timeline_summary',
      name: 'Lead Timeline Summary',
      category: 'crm',
      description: 'Summarize lead history and recommend next actions.',
      examples: ['Summarize this lead', 'Why is this lead hot?'],
      inputsSchema: { type: 'object', properties: { leadId: { type: 'string' } }, required: ['leadId'] },
      playbook: 'Fetch timeline, surface intent and objections, propose a task or message draft.',
      restrictions: ['Do not send messages automatically'],
      tools: ['get_lead_timeline', 'list_tasks', 'list_notifications'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'task_and_notification_management',
      name: 'Task and Notification Management',
      category: 'crm',
      description: 'Create, update, and prioritize tasks/notifications.',
      examples: ['Create a task', 'Mark notification read'],
      inputsSchema: { type: 'object', properties: {} },
      playbook: 'List tasks/notifications, update statuses, create tasks with clear titles.',
      restrictions: [],
      tools: ['list_tasks', 'create_task', 'update_task', 'list_notifications', 'mark_notification_read'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'customer_management',
      name: 'Customer Management',
      category: 'crm',
      description: 'CRUD for customer CRM records.',
      examples: ['Update customer record', 'Find customers'],
      inputsSchema: { type: 'object', properties: { customerId: { type: 'string' } } },
      playbook: 'Fetch customer, apply updates cautiously, avoid PII leakage.',
      restrictions: ['Protect PII'],
      tools: ['list_customers', 'get_customer_detail'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    // Campaigns / Analytics
    {
      id: 'campaign_management',
      name: 'Campaign Management',
      category: 'campaigns',
      description: 'Create or update campaigns.',
      examples: ['Create a campaign', 'Update campaign'],
      inputsSchema: { type: 'object', properties: { campaignId: { type: 'string' } } },
      playbook: 'List campaigns, edit targeting/metadata with confirmation for status changes.',
      restrictions: ['Confirmation for status changes'],
      tools: ['list_campaigns', 'get_campaign_performance'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'campaign_performance_review',
      name: 'Campaign Performance Review',
      category: 'campaigns',
      description: 'Analyze campaign performance and ROI.',
      examples: ['Review campaigns', 'How are campaigns performing?'],
      inputsSchema: { type: 'object', properties: {} },
      playbook: 'Fetch campaign performance, highlight best/worst, suggest changes.',
      restrictions: ['No direct campaign edits without confirmation'],
      tools: ['get_campaign_performance', 'list_campaigns', 'get_analytics_dashboard'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'analytics_dashboard_review',
      name: 'Analytics Dashboard Review',
      category: 'analytics',
      description: 'Summarize analytics dashboard and trends.',
      examples: ['Summarize analytics', 'What are the top KPIs?'],
      inputsSchema: { type: 'object', properties: {} },
      playbook: 'Review analytics dashboard, call out trends and anomalies.',
      restrictions: ['Read-only'],
      tools: ['get_analytics_dashboard'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    // Settings & Ops
    {
      id: 'settings_management',
      name: 'Settings Management',
      category: 'settings',
      description: 'Read/update tenant settings.',
      examples: ['Update settings', 'Show settings'],
      inputsSchema: { type: 'object', properties: {} },
      playbook: 'Load settings, propose updates, require confirmation for writes.',
      restrictions: ['Require confirmation'],
      tools: ['get_settings', 'update_settings'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'ai_provider_management',
      name: 'AI Provider Management',
      category: 'ai',
      description: 'Manage AI providers (Gemini, others).',
      examples: ['Add Gemini provider', 'List AI providers'],
      inputsSchema: { type: 'object', properties: {} },
      playbook: 'List providers and add/update with tenant scope.',
      restrictions: ['Do not overwrite without confirmation'],
      tools: ['list_ai_providers', 'register_ai_provider'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'ai_automation_plan_management',
      name: 'AI Automation Plan Management',
      category: 'ai',
      description: 'Manage AI automation plans.',
      examples: ['List automation plans', 'Create automation plan'],
      inputsSchema: { type: 'object', properties: {} },
      playbook: 'List recent plans, create new plan steps when requested.',
      restrictions: [],
      tools: ['list_automation_plans'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'ai_web_fetch_orchestration',
      name: 'AI Web Fetch Orchestration',
      category: 'ai',
      description: 'Use AI web fetch safely for research.',
      examples: ['Fetch this URL', 'Queue a web fetch'],
      inputsSchema: { type: 'object', properties: { url: { type: 'string' } } },
      playbook: 'Validate domain safety, set purpose and size, respect rate limits.',
      restrictions: ['Respect allowlist/rate limits'],
      tools: ['ai_web_fetch'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    },
    {
      id: 'metrics_and_health_review',
      name: 'Metrics and Health Review',
      category: 'system',
      description: 'Review metrics, health, and capability status.',
      examples: ['Check metrics', 'Health status'],
      inputsSchema: { type: 'object', properties: {} },
      playbook: 'Call metrics/health/capabilities endpoints and summarize issues.',
      restrictions: ['Read-only'],
      tools: ['get_metrics', 'get_health', 'get_capabilities_status'],
      autopilotLevel: 1,
      status: 'active',
      version: 1
    }
  ];
}

function list(options = {}) {
  ensureShape();
  const tenant = normalizeTenantId(options.tenantId || options.tenant);
  return datasets.evals
    .filter(entry => matchesTenant(entry.tenantId, tenant))
    .filter(entry => (options.status ? entry.status === options.status : true))
    .map(safe);
}

function getById(id, tenantId) {
  ensureShape();
  const tenant = normalizeTenantId(tenantId);
  const found = datasets.evals.find(entry => matchesTenant(entry.tenantId, tenant) && entry.id === id);
  return found ? safe(found) : null;
}

function create(payload, tenantId, createdBy = 'human') {
  ensureShape();
  const tenant = normalizeTenantId(tenantId);
  const sanitized = sanitizePayloadStrings(payload, ['id', 'name', 'category', 'description', 'status']);
  const now = new Date().toISOString();
  const evalDef = {
    id: sanitized.id || `eval_${randomUUID()}`,
    tenantId: tenant,
    name: sanitized.name,
    category: sanitized.category || 'general',
    description: sanitized.description,
    examples: payload.examples || [],
    inputsSchema: payload.inputsSchema || { type: 'object' },
    playbook: payload.playbook || '',
    restrictions: payload.restrictions || [],
    tools: payload.tools || [],
    autopilotLevel: payload.autopilotLevel ?? 0,
    status: sanitized.status || 'draft',
    version: payload.version || 1,
    createdBy,
    createdAt: now,
    updatedAt: now
  };
  datasets.evals.push(evalDef);
  persist.evals(datasets.evals);
  return safe(evalDef);
}

function update(id, payload, tenantId) {
  ensureShape();
  const tenant = normalizeTenantId(tenantId);
  const index = datasets.evals.findIndex(entry => matchesTenant(entry.tenantId, tenant) && entry.id === id);
  if (index < 0) return { notFound: true };
  const sanitized = sanitizePayloadStrings(payload, ['name', 'category', 'description', 'status']);
  const now = new Date().toISOString();
  const updated = {
    ...datasets.evals[index],
    ...sanitized,
    examples: payload.examples ?? datasets.evals[index].examples,
    inputsSchema: payload.inputsSchema ?? datasets.evals[index].inputsSchema,
    playbook: payload.playbook ?? datasets.evals[index].playbook,
    restrictions: payload.restrictions ?? datasets.evals[index].restrictions,
    tools: payload.tools ?? datasets.evals[index].tools,
    autopilotLevel: payload.autopilotLevel ?? datasets.evals[index].autopilotLevel,
    version: (datasets.evals[index].version || 1) + 1,
    updatedAt: now
  };
  datasets.evals[index] = updated;
  persist.evals(datasets.evals);
  return { eval: safe(updated) };
}

function setStatus(id, status, tenantId) {
  return update(id, { status }, tenantId);
}

module.exports = {
  ensureShape,
  seedIfEmpty,
  list,
  getById,
  create,
  update,
  setStatus,
  baseCatalog
};
