const inventoryService = require('./inventoryService');
const inventoryDisplayConfigService = require('./inventoryDisplayConfigService');
const taskService = require('./taskService');
const notificationService = require('./notificationService');
const leadService = require('./leadService');
const customerService = require('./customerService');
const serviceTicketService = require('./serviceTicketService');
const financeOfferService = require('./financeOfferService');
const contentPageService = require('./contentPageService');
const pageLayoutService = require('./pageLayoutService');
const seoService = require('./seoService');
const redirectService = require('./redirectService');
const analyticsService = require('./analyticsService');
const campaignService = require('./campaignService');
const experimentService = require('./experimentService');
const aiService = require('./aiService');
const webhookService = require('./webhookService');
const exportService = require('./exportService');
const capabilityService = require('./capabilityService');
const aiLogService = require('./aiLogService');
const { escapeOutputPayload } = require('./shared');

const TOOL_HANDLERS = {
  get_inventory_unit: (args, tenantId) => inventoryService.getById(args.id, tenantId),
  search_inventory: (args, tenantId) => inventoryService.list(args || {}, tenantId),
  update_inventory_specs: (args, tenantId) => inventoryService.update(args.id, args.patch || {}, tenantId),
  update_inventory_story: (args, tenantId, user) =>
    inventoryService.updateStory(args.id, args.story || '', tenantId, user?.email || user?.id),
  recompute_inventory_badges: (_args, tenantId) => inventoryService.recomputeBadges({}, tenantId),
  get_inventory_display_config: (_args, tenantId) => inventoryDisplayConfigService.get(tenantId),
  update_inventory_display_config: (args, tenantId) => inventoryDisplayConfigService.update(args || {}, tenantId),

  list_leads: (args, tenantId) => leadService.list(args || {}, tenantId),
  get_lead_detail: (args, tenantId) => leadService.get(args.id, tenantId),
  get_lead_timeline: (args, tenantId) => leadService.timeline(args.id, tenantId),
  update_lead_status: (args, tenantId) => leadService.updateStatus(args.id, args.status, tenantId),

  list_tasks: (args, tenantId) => taskService.list(args || {}, tenantId),
  create_task: (args, tenantId) => taskService.create(args || {}, tenantId),
  update_task: (args, tenantId) => taskService.update(args.id, args || {}, tenantId),

  list_notifications: (args, tenantId) => notificationService.list(args || {}, tenantId),
  update_notification: (args, tenantId) => notificationService.updateStatus(args.id, args.status, tenantId),

  list_customers: (args, tenantId) => customerService.list(args || {}, tenantId),
  get_customer_detail: (args, tenantId) => customerService.get(args.id, tenantId),

  list_service_tickets: (args, tenantId) => serviceTicketService.list(args || {}, tenantId),
  get_service_ticket: (args, tenantId) => serviceTicketService.get(args.id, tenantId),

  list_finance_offers: (args, tenantId) => financeOfferService.list(args || {}, tenantId),

  list_content_pages: (args, tenantId) => contentPageService.list(args || {}, tenantId),
  get_content_page: (args, tenantId) => contentPageService.findById(args.id, tenantId),
  update_content_page: (args, tenantId) => contentPageService.update(args.id, args.patch || {}, tenantId),

  get_page_layout: (args, tenantId) => pageLayoutService.getByPage(args.id, tenantId),
  update_page_layout: (args, tenantId) => pageLayoutService.saveDraft(args.id, args.layout || {}, tenantId),

  list_seo_profiles: (args, tenantId) => seoService.list(args || {}, tenantId),
  autofill_seo_profile: (_args, tenantId) => seoService.autofillMissing(tenantId),
  get_seo_health: (_args, tenantId) => seoService.seoHealth(tenantId),

  list_redirects: (args, tenantId) => redirectService.list(args || {}, tenantId),
  create_redirect: (args, tenantId) => redirectService.create(args, tenantId),
  delete_redirect: (args, tenantId) => redirectService.remove(args.id, tenantId),

  list_campaigns: (args, tenantId) => campaignService.list(args || {}, tenantId),
  get_campaign_performance: (_args, tenantId) => campaignService.performance(tenantId),
  get_analytics_dashboard: (_args, tenantId) => analyticsService.dashboard(tenantId),

  get_experiment_detail: (args, tenantId) => experimentService.getById(args.id, tenantId),

  list_ai_providers: (_args, tenantId) => aiService.listProviders(tenantId),
  register_ai_provider: (args, tenantId) => aiService.registerProvider(args, tenantId),

  ai_web_fetch: (args, tenantId) => aiService.performWebFetch(args, tenantId),
  list_web_fetches: (_args, tenantId) => aiService.listWebFetches(tenantId),

  list_webhooks: (args, tenantId) => webhookService.list(args || {}, tenantId),
  create_webhook: (args, tenantId) => webhookService.create(args, tenantId),
  update_webhook: (args, tenantId) => webhookService.update(args.id, args, tenantId),
  delete_webhook: (args, tenantId) => webhookService.remove(args.id, tenantId),
  list_webhook_deliveries: (args, tenantId) => webhookService.deliveries(args || {}, tenantId),

  create_tenant_snapshot: (_args, tenantId) => exportService.snapshot(tenantId),
  get_metrics: () => ({ metrics: 'ok' }),
  get_health: () => ({ health: 'ok' }),
  get_capabilities_status: (_args, tenantId) => capabilityService.status(tenantId)
};

function execute(toolName, args = {}, tenantId, user) {
  const handler = TOOL_HANDLERS[toolName];
  if (!handler) {
    return { error: 'Unknown tool', tool: toolName };
  }
  try {
    const result = handler(args, tenantId, user);
    aiLogService.log(
      {
        type: 'tool_call',
        toolCalls: [{ name: toolName, args, result }],
        tenantId,
        user,
        success: true
      },
      tenantId
    );
    return escapeOutputPayload(result);
  } catch (err) {
    aiLogService.log(
      {
        type: 'tool_call',
        toolCalls: [{ name: toolName, args, error: err.message }],
        tenantId,
        user,
        success: false,
        error: err.message
      },
      tenantId
    );
    return { error: err.message, tool: toolName };
  }
}

module.exports = {
  execute,
  TOOL_HANDLERS
};
