const fs = require('fs');
const path = require('path');
const { datasets, persist } = require('./state');
const { escapeOutputPayload, sanitizePayloadStrings } = require('./shared');
const { normalizeTenantId, matchesTenant } = require('./tenantService');

const ROOT_DIR = path.resolve(path.join(__dirname, '..', '..'));

function safe(value) {
  return escapeOutputPayload(value);
}

const DEFAULT_PROVIDERS = [
  {
    id: 'openai-primary',
    name: 'OpenAI Primary',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.1-pro',
    capabilities: ['chat', 'tools', 'embeddings'],
    surfaces: ['chat', 'voice'],
    note: 'Default OpenAI stack for fast responses and drafting.'
  },
  {
    id: 'gemini3-primary',
    name: 'Gemini 3 Pro',
    type: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.0-pro',
    capabilities: ['chat', 'tools', 'multimodal'],
    surfaces: ['chat', 'voice'],
    note: 'Long-context researcher for specs, analytics, and web fetches.'
  }
];

const DEFAULT_TOOL_REGISTRY = [
  {
    name: 'get_inventory_unit',
    description: 'Fetch detailed info about an inventory unit by ID for the current tenant.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' }
      },
      required: ['id']
    },
    route: { method: 'GET', path: '/v1/inventory/:id', auth: 'user', tenantScoped: true },
    category: 'inventory'
  },
  {
    name: 'search_inventory',
    description: 'Search inventory with filters and sorting.',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Free text query' },
        status: { type: 'string' },
        category: { type: 'string' },
        priceMin: { type: 'number' },
        priceMax: { type: 'number' },
        sortBy: { type: 'string', enum: ['price', 'year', 'createdAt'] },
        limit: { type: 'number' }
      }
    },
    route: { method: 'GET', path: '/v1/inventory', auth: 'user', tenantScoped: true },
    category: 'inventory'
  },
  {
    name: 'update_inventory_story',
    description: 'Update the sales story/description for an inventory unit.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        story: { type: 'string', description: 'Short, customer-facing story' }
      },
      required: ['id', 'story']
    },
    requiresConfirmation: true,
    allowedRoles: ['admin', 'sales'],
    route: { method: 'PATCH', path: '/v1/inventory/:id/story', auth: 'user', tenantScoped: true },
    category: 'inventory'
  },
  {
    name: 'update_inventory_specs',
    description: 'Patch missing or incorrect specs on an inventory unit.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        patch: { type: 'object', description: 'Partial inventory payload with updated specs' },
        source: { type: 'string', description: 'Reference for where the data came from' }
      },
      required: ['id', 'patch']
    },
    requiresConfirmation: true,
    allowedRoles: ['admin', 'sales'],
    route: { method: 'PUT', path: '/v1/inventory/:id', auth: 'user', tenantScoped: true },
    category: 'inventory'
  },
  {
    name: 'recompute_inventory_badges',
    description: 'Re-run badge computation for one or many units.',
    parameters: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of inventory IDs to target. If omitted, recompute all.'
        }
      }
    },
    requiresConfirmation: true,
    allowedRoles: ['admin', 'marketing'],
    route: { method: 'POST', path: '/v1/inventory/bulk/recompute-badges', auth: 'user', tenantScoped: true },
    category: 'inventory'
  },
  {
    name: 'list_leads',
    description: 'List leads with optional filters for score, intent, age, and campaign.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        minScore: { type: 'number' },
        lastActivityBefore: { type: 'string', description: 'ISO timestamp' },
        source: { type: 'string' },
        interestedInStockNumber: { type: 'string' },
        limit: { type: 'number' }
      }
    },
    route: { method: 'GET', path: '/v1/leads', auth: 'user', tenantScoped: true },
    category: 'crm'
  },
  {
    name: 'get_lead_detail',
    description: 'Get lead details by ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' }
      },
      required: ['id']
    },
    route: { method: 'GET', path: '/v1/leads/:id', auth: 'user', tenantScoped: true },
    category: 'crm'
  },
  {
    name: 'get_lead_timeline',
    description: 'Fetch the activity timeline for a lead.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' }
      },
      required: ['id']
    },
    route: { method: 'GET', path: '/v1/leads/:id/timeline', auth: 'user', tenantScoped: true },
    category: 'crm'
  },
  {
    name: 'update_lead_status',
    description: 'Update a lead status (hot, working, won, lost, etc.).',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string' }
      },
      required: ['id', 'status']
    },
    requiresConfirmation: true,
    allowedRoles: ['admin', 'sales', 'marketing'],
    route: { method: 'PATCH', path: '/v1/leads/:id/status', auth: 'user', tenantScoped: true },
    category: 'crm'
  },
  {
    name: 'list_tasks',
    description: 'List tasks with optional status/assignee filters.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        assignedTo: { type: 'string' },
        limit: { type: 'number' }
      }
    },
    route: { method: 'GET', path: '/v1/tasks', auth: 'user', tenantScoped: true },
    category: 'crm'
  },
  {
    name: 'create_task',
    description: 'Create a follow-up task for a teammate.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        notes: { type: 'string' },
        assignedTo: { type: 'string' },
        status: { type: 'string', enum: ['open', 'in_progress', 'completed', 'canceled'] }
      },
      required: ['title']
    },
    requiresConfirmation: true,
    allowedRoles: ['admin', 'sales', 'marketing'],
    route: { method: 'POST', path: '/v1/tasks', auth: 'user', tenantScoped: true },
    category: 'crm'
  },
  {
    name: 'list_notifications',
    description: 'List notifications and alerts for the current user.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        limit: { type: 'number' }
      }
    },
    route: { method: 'GET', path: '/v1/notifications', auth: 'user', tenantScoped: true },
    category: 'crm'
  },
  {
    name: 'mark_notification_read',
    description: 'Mark a notification as read.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['read', 'unread'] }
      },
      required: ['id']
    },
    requiresConfirmation: true,
    allowedRoles: ['admin', 'sales', 'marketing'],
    route: { method: 'PATCH', path: '/v1/notifications/:id', auth: 'user', tenantScoped: true },
    category: 'crm'
  },
  {
    name: 'list_customers',
    description: 'List customers with optional filters.',
    parameters: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        phone: { type: 'string' },
        lastActivityBefore: { type: 'string', description: 'ISO timestamp' }
      }
    },
    route: { method: 'GET', path: '/v1/customers', auth: 'user', tenantScoped: true },
    category: 'crm'
  },
  {
    name: 'get_customer_detail',
    description: 'Get a customer record by ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' }
      },
      required: ['id']
    },
    route: { method: 'GET', path: '/v1/customers/:id', auth: 'user', tenantScoped: true },
    category: 'crm'
  },
  {
    name: 'list_tasks',
    description: 'List tasks with optional status/assignee filters.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        assignedTo: { type: 'string' },
        limit: { type: 'number' }
      }
    },
    route: { method: 'GET', path: '/v1/tasks', auth: 'user', tenantScoped: true },
    category: 'crm'
  },
  {
    name: 'create_task',
    description: 'Create a follow-up task for a teammate.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        notes: { type: 'string' },
        assignedTo: { type: 'string' },
        status: { type: 'string', enum: ['open', 'in_progress', 'completed', 'canceled'] }
      },
      required: ['title']
    },
    requiresConfirmation: true,
    allowedRoles: ['admin', 'sales', 'marketing'],
    route: { method: 'POST', path: '/v1/tasks', auth: 'user', tenantScoped: true },
    category: 'crm'
  },
  {
    name: 'update_task',
    description: 'Update a task status or notes.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string' },
        notes: { type: 'string' }
      },
      required: ['id']
    },
    requiresConfirmation: true,
    allowedRoles: ['admin', 'sales', 'marketing'],
    route: { method: 'PATCH', path: '/v1/tasks/:id', auth: 'user', tenantScoped: true },
    category: 'crm'
  },
  {
    name: 'list_service_tickets',
    description: 'List service tickets.',
    parameters: { type: 'object', properties: {} },
    route: { method: 'GET', path: '/v1/service-tickets', auth: 'user', tenantScoped: true },
    category: 'service'
  },
  {
    name: 'get_service_ticket',
    description: 'Get a service ticket by ID.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id']
    },
    route: { method: 'GET', path: '/v1/service-tickets/:id', auth: 'user', tenantScoped: true },
    category: 'service'
  },
  {
    name: 'list_finance_offers',
    description: 'List finance offers.',
    parameters: { type: 'object', properties: {} },
    route: { method: 'GET', path: '/v1/finance-offers', auth: 'user', tenantScoped: true },
    category: 'finance'
  },
  {
    name: 'list_webhooks',
    description: 'List webhooks for the tenant.',
    parameters: { type: 'object', properties: {} },
    route: { method: 'GET', path: '/v1/webhooks', auth: 'user', tenantScoped: true },
    category: 'integrations'
  },
  {
    name: 'create_webhook',
    description: 'Create a webhook.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        description: { type: 'string' }
      },
      required: ['url']
    },
    requiresConfirmation: true,
    allowedRoles: ['admin', 'marketing'],
    route: { method: 'POST', path: '/v1/webhooks', auth: 'user', tenantScoped: true },
    category: 'integrations'
  },
  {
    name: 'list_webhook_deliveries',
    description: 'List webhook delivery history.',
    parameters: { type: 'object', properties: {} },
    route: { method: 'GET', path: '/v1/webhooks/deliveries', auth: 'user', tenantScoped: true },
    category: 'integrations'
  },
  {
    name: 'create_tenant_snapshot',
    description: 'Trigger a tenant snapshot export.',
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: true,
    allowedRoles: ['admin'],
    route: { method: 'POST', path: '/v1/exports/snapshot', auth: 'user', tenantScoped: true },
    category: 'integrations'
  },
  {
    name: 'get_metrics',
    description: 'Fetch metrics for the system.',
    parameters: { type: 'object', properties: {} },
    route: { method: 'GET', path: '/v1/metrics', auth: 'public', tenantScoped: true },
    category: 'system'
  },
  {
    name: 'get_health',
    description: 'Fetch health status.',
    parameters: { type: 'object', properties: {} },
    route: { method: 'GET', path: '/v1/health', auth: 'public', tenantScoped: true },
    category: 'system'
  },
  {
    name: 'read_audit_logs',
    description: 'Read audit log entries.',
    parameters: { type: 'object', properties: {} },
    route: { method: 'GET', path: '/v1/audit/logs', auth: 'admin', tenantScoped: true },
    category: 'system'
  }
  {
    name: 'list_content_pages',
    description: 'List content pages by ID or slug.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        status: { type: 'string' }
      }
    },
    route: { method: 'GET', path: '/v1/content', auth: 'user', tenantScoped: true },
    category: 'seo'
  },
  {
    name: 'get_content_page',
    description: 'Fetch a content page by ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' }
      },
      required: ['id']
    },
    route: { method: 'GET', path: '/v1/content/:id', auth: 'user', tenantScoped: true },
    category: 'seo'
  },
  {
    name: 'update_content_page',
    description: 'Update a content page body/metadata.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        patch: { type: 'object', description: 'Partial content page payload' }
      },
      required: ['id', 'patch']
    },
    requiresConfirmation: true,
    allowedRoles: ['admin', 'marketing'],
    route: { method: 'PUT', path: '/v1/content/:id', auth: 'user', tenantScoped: true },
    category: 'seo'
  },
  {
    name: 'list_seo_profiles',
    description: 'List SEO profiles for inventory or pages.',
    parameters: {
      type: 'object',
      properties: {
        resourceType: { type: 'string', enum: ['inventory', 'content'] },
        resourceId: { type: 'string' }
      }
    },
    route: { method: 'GET', path: '/v1/seo/profiles', auth: 'user', tenantScoped: true },
    category: 'seo'
  },
  {
    name: 'autofill_seo_profile',
    description: 'Autofill missing SEO profiles for the tenant.',
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: true,
    allowedRoles: ['admin', 'marketing'],
    route: { method: 'POST', path: '/v1/seo/autofill', auth: 'user', tenantScoped: true },
    category: 'seo'
  },
  {
    name: 'get_seo_health',
    description: 'Get SEO health summary for the tenant.',
    parameters: { type: 'object', properties: {} },
    route: { method: 'GET', path: '/v1/seo/health', auth: 'user', tenantScoped: true },
    category: 'seo'
  },
  {
    name: 'get_page_layout',
    description: 'Fetch page layout draft for a content page.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' }
      },
      required: ['id']
    },
    route: { method: 'GET', path: '/v1/content/:id/layout', auth: 'user', tenantScoped: true },
    category: 'seo'
  },
  {
    name: 'update_page_layout',
    description: 'Update page layout blocks for a content page.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        layout: { type: 'object' }
      },
      required: ['id', 'layout']
    },
    requiresConfirmation: true,
    allowedRoles: ['admin', 'marketing'],
    route: { method: 'POST', path: '/v1/content/:id/layout', auth: 'user', tenantScoped: true },
    category: 'seo'
  },
  {
    name: 'get_analytics_dashboard',
    description: 'Retrieve analytics dashboard rollups.',
    parameters: { type: 'object', properties: {} },
    route: { method: 'GET', path: '/v1/analytics/dashboard', auth: 'user', tenantScoped: true },
    category: 'analytics'
  },
  {
    name: 'list_campaigns',
    description: 'List campaigns with targeting and attribution data.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        slug: { type: 'string' }
      }
    },
    route: { method: 'GET', path: '/v1/campaigns', auth: 'user', tenantScoped: true },
    category: 'campaigns'
  },
  {
    name: 'get_campaign_performance',
    description: 'Campaign performance rollup with sessions and leads.',
    parameters: { type: 'object', properties: {} },
    route: { method: 'GET', path: '/v1/reports/campaigns/performance', auth: 'user', tenantScoped: true },
    category: 'campaigns'
  },
  {
    name: 'get_experiment_detail',
    description: 'Get an experiment definition by ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' }
      },
      required: ['id']
    },
    route: { method: 'GET', path: '/v1/experiments/:id', auth: 'user', tenantScoped: true },
    category: 'analytics'
  },
  {
    name: 'ai_web_fetch',
    description: 'Fetch and sanitize remote web content for AI processing.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL to fetch' },
        purpose: { type: 'string', description: 'Why this page is being fetched' },
        maxBytes: { type: 'number', description: 'Cap fetch size to this many bytes' }
      },
      required: ['url']
    },
    route: { method: 'POST', path: '/v1/ai/web-fetch', auth: 'user', tenantScoped: true },
    category: 'web-research'
  },
  {
    name: 'ai_log_observation',
    description: 'Record an AI observation for audit/history.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        message: { type: 'string' },
        resourceType: { type: 'string' },
        resourceId: { type: 'string' }
      },
      required: ['message']
    },
    route: { method: 'POST', path: '/v1/ai/observe', auth: 'user', tenantScoped: true },
    category: 'web-research'
  },
  {
    name: 'get_capabilities_status',
    description: 'View capability status checklist for the tenant.',
    parameters: { type: 'object', properties: {} },
    route: { method: 'GET', path: '/v1/capabilities/status', auth: 'public', tenantScoped: true },
    category: 'core-data'
  },
  {
    name: 'get_inventory_display_config',
    description: 'Fetch inventory display configuration for list/detail layouts.',
    parameters: { type: 'object', properties: {} },
    route: { method: 'GET', path: '/v1/inventory-display-config', auth: 'user', tenantScoped: true },
    category: 'inventory'
  },
  {
    name: 'update_inventory_display_config',
    description: 'Update inventory display configuration for list/detail layouts.',
    parameters: {
      type: 'object',
      properties: {
        listView: { type: 'object' },
        detailView: { type: 'object' }
      }
    },
    requiresConfirmation: true,
    allowedRoles: ['admin', 'marketing'],
    route: { method: 'PUT', path: '/v1/inventory-display-config', auth: 'user', tenantScoped: true },
    category: 'inventory'
  },
  {
    name: 'get_settings',
    description: 'Get tenant settings (branding, hours, address).',
    parameters: { type: 'object', properties: {} },
    route: { method: 'GET', path: '/v1/settings', auth: 'user', tenantScoped: true },
    category: 'core-data'
  },
  {
    name: 'update_settings',
    description: 'Update tenant settings with guardrails.',
    parameters: {
      type: 'object',
      properties: {
        patch: { type: 'object' }
      },
      required: ['patch']
    },
    requiresConfirmation: true,
    allowedRoles: ['admin'],
    route: { method: 'PATCH', path: '/v1/settings', auth: 'user', tenantScoped: true },
    category: 'core-data'
  },
  {
    name: 'get_team_members',
    description: 'List team members for the tenant.',
    parameters: { type: 'object', properties: {} },
    route: { method: 'GET', path: '/v1/teams', auth: 'public', tenantScoped: true },
    category: 'core-data'
  },
  {
    name: 'get_reviews',
    description: 'List published reviews/testimonials.',
    parameters: { type: 'object', properties: {} },
    route: { method: 'GET', path: '/v1/reviews', auth: 'public', tenantScoped: true },
    category: 'core-data'
  },
  {
    name: 'search_competitor_inventory',
    description: 'Run a focused search against competitor domains for a specific unit or query.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search string including model/year plus site:domain filter' },
        limit: { type: 'number', description: 'Max results to return' }
      },
      required: ['query']
    },
    route: {
      method: 'POST',
      path: '/v1/ai/web-fetch',
      auth: 'user',
      tenantScoped: true,
      note: 'Executes allowlisted search/fetch for competitor inventory'
    },
    category: 'competitor'
  },
  {
    name: 'fetch_competitor_listing',
    description: 'Fetch and parse a specific competitor listing page for price/options/mileage.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Competitor VDP URL' },
        purpose: { type: 'string', description: 'Why this listing is being inspected' }
      },
      required: ['url']
    },
    route: {
      method: 'POST',
      path: '/v1/ai/web-fetch',
      auth: 'user',
      tenantScoped: true,
      note: 'Requires allowlisted domains'
    },
    category: 'competitor'
  },
  {
    name: 'summarize_competitor_offers',
    description: 'Summarize competitor offers vs our price/features for a target unit.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Unit name/stockNumber we are comparing against' },
        competitors: {
          type: 'array',
          items: { type: 'object' },
          description: 'Structured competitor data fetched earlier'
        }
      }
    },
    category: 'competitor'
  }
];

const DEFAULT_TOOL_PROFILES = [
  {
    id: 'core-data',
    name: 'Core data',
    description: 'Settings, team, capabilities, and reviews.',
    tools: ['get_capabilities_status', 'get_settings', 'update_settings', 'get_team_members', 'get_reviews']
  },
  {
    id: 'inventory',
    name: 'Inventory + merchandising',
    description: 'Read/update inventory plus badge recomputes.',
    tools: [
      'get_inventory_unit',
      'search_inventory',
      'update_inventory_story',
      'update_inventory_specs',
      'recompute_inventory_badges',
      'get_inventory_display_config',
      'update_inventory_display_config'
    ]
  },
  {
    id: 'crm',
    name: 'CRM + engagement',
    description: 'Leads, tasks, notifications, and customers.',
    tools: [
      'list_leads',
      'get_lead_detail',
      'get_lead_timeline',
      'update_lead_status',
      'list_tasks',
      'create_task',
      'list_notifications',
      'mark_notification_read',
      'list_customers',
      'get_customer_detail'
    ]
  },
  {
    id: 'seo',
    name: 'Content + SEO',
    description: 'Content pages, layouts, and SEO health.',
    tools: [
      'list_content_pages',
      'get_content_page',
      'update_content_page',
      'list_seo_profiles',
      'autofill_seo_profile',
      'get_seo_health',
      'get_page_layout',
      'update_page_layout'
    ]
  },
  {
    id: 'analytics',
    name: 'Analytics + experiments',
    description: 'Analytics dashboard and experiments.',
    tools: ['get_analytics_dashboard', 'get_experiment_detail']
  },
  {
    id: 'campaigns',
    name: 'Campaigns',
    description: 'Campaign list and performance.',
    tools: ['list_campaigns', 'get_campaign_performance']
  },
  {
    id: 'web-research',
    name: 'Web research + AI logging',
    description: 'AI web fetch and observation logging.',
    tools: ['ai_web_fetch', 'ai_log_observation']
  },
  {
    id: 'competitor-intel',
    name: 'Competitor research',
    description: 'Targeted competitor inventory searches and comparisons.',
    tools: ['search_competitor_inventory', 'fetch_competitor_listing', 'summarize_competitor_offers']
  },
  {
    id: 'integrations',
    name: 'Integrations & ops',
    description: 'Webhooks, exports, metrics, audit logs.',
    tools: ['list_webhooks', 'create_webhook', 'list_webhook_deliveries', 'create_tenant_snapshot', 'get_metrics', 'get_health', 'read_audit_logs']
  }
];

const DEFAULT_AGENT_GUARDRAILS = [
  'Never change prices or discounts without explicit user confirmation.',
  'Stay within the active tenant; do not access or modify other tenants.',
  'For mutating tools marked requiresConfirmation, propose the change and wait for human approval.',
  'Log observations for notable actions or surprises.'
];

const DEFAULT_AGENTS = [
  {
    id: 'global-assistant',
    name: 'Sewell Brain',
    providerId: 'gemini3-primary',
    fallbackProviderId: 'openai-primary',
    toolProfileIds: ['core-data', 'inventory', 'crm', 'analytics', 'seo', 'campaigns', 'web-research'],
    systemPromptTemplate: 'docs/ai/system/global-assistant.md',
    purpose: 'General-purpose assistant for the Sewell backend and chat widget.',
    guardrails: DEFAULT_AGENT_GUARDRAILS
  },
  {
    id: 'inventory-enrichment',
    name: 'Inventory Researcher',
    providerId: 'gemini3-primary',
    fallbackProviderId: 'openai-primary',
    toolProfileIds: ['inventory', 'seo', 'web-research'],
    systemPromptTemplate: 'docs/ai/system/inventory-enrichment.md',
    purpose: 'Fill missing inventory specs using trusted web sources.',
    playbook: {
      steps: [
        'Call get_inventory_unit to inspect missing fields.',
        'Plan 2-3 targeted fetches to manufacturer/spec sources.',
        'Use ai_web_fetch for specific URLs with a short purpose note.',
        'Apply update_inventory_specs with a minimal patch and source evidence.'
      ],
      maxWebFetches: 3,
      requiresSources: true
    },
    guardrails: [
      ...DEFAULT_AGENT_GUARDRAILS,
      'Prefer manufacturer data; avoid forums or untrusted sources.',
      'Annotate patches with source notes when available.'
    ]
  },
  {
    id: 'market-intel',
    name: 'Market Scout',
    providerId: 'gemini3-primary',
    toolProfileIds: ['web-research', 'inventory', 'analytics', 'campaigns', 'competitor-intel'],
    systemPromptTemplate: 'docs/ai/system/market-intel.md',
    purpose: 'Competitor and market analysis using analytics plus web research.',
    guardrails: DEFAULT_AGENT_GUARDRAILS
  },
  {
    id: 'lead-hunter',
    name: 'Lead Hunter',
    providerId: 'openai-primary',
    toolProfileIds: ['crm', 'analytics', 'campaigns', 'inventory'],
    systemPromptTemplate: 'docs/ai/system/lead-hunter.md',
    purpose: 'Prioritize leads, propose follow-ups, and draft tasks.',
    guardrails: [
      ...DEFAULT_AGENT_GUARDRAILS,
      'Do not send outbound messages; only suggest copy or create internal tasks.'
    ]
  }
];

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
}

function mergeMissingFields(target, defaults) {
  Object.keys(defaults).forEach(key => {
    if (target[key] === undefined) {
      target[key] = defaults[key];
    }
  });
}

function seedProviders(tenant) {
  let changed = false;
  DEFAULT_PROVIDERS.forEach(defaultProvider => {
    const existing = datasets.aiControl.providers.find(
      entry => matchesTenant(entry.tenantId, tenant) && (entry.provider === defaultProvider.id || entry.id === defaultProvider.id)
    );
    if (!existing) {
      datasets.aiControl.providers.push({
        id: defaultProvider.id,
        tenantId: tenant,
        name: defaultProvider.name,
        provider: defaultProvider.id,
        type: defaultProvider.type,
        baseUrl: defaultProvider.baseUrl,
        defaultModel: defaultProvider.defaultModel,
        model: defaultProvider.defaultModel,
        capabilities: defaultProvider.capabilities,
        surfaces: defaultProvider.surfaces,
        note: defaultProvider.note,
        createdAt: new Date().toISOString()
      });
      changed = true;
      return;
    }
    mergeMissingFields(existing, {
      name: defaultProvider.name,
      type: defaultProvider.type,
      baseUrl: defaultProvider.baseUrl,
      defaultModel: defaultProvider.defaultModel,
      capabilities: defaultProvider.capabilities,
      surfaces: defaultProvider.surfaces,
      note: existing.note || defaultProvider.note
    });
  });
  return changed;
}

function seedToolRegistry(tenant) {
  let changed = false;
  DEFAULT_TOOL_REGISTRY.forEach(tool => {
    const existing = datasets.aiControl.toolRegistry.find(
      entry => matchesTenant(entry.tenantId, tenant) && entry.name === tool.name
    );
    if (!existing) {
      datasets.aiControl.toolRegistry.push({
        ...tool,
        id: tool.name,
        tenantId: tenant
      });
      changed = true;
      return;
    }
    mergeMissingFields(existing, { ...tool, tenantId: tenant });
  });
  return changed;
}

function seedToolProfiles(tenant) {
  let changed = false;
  DEFAULT_TOOL_PROFILES.forEach(profile => {
    const existing = datasets.aiControl.toolProfiles.find(
      entry => matchesTenant(entry.tenantId, tenant) && entry.id === profile.id
    );
    if (!existing) {
      datasets.aiControl.toolProfiles.push({ ...profile, tenantId: tenant });
      changed = true;
      return;
    }
    mergeMissingFields(existing, { ...profile, tenantId: tenant });
  });
  return changed;
}

function seedAgents(tenant) {
  let changed = false;
  DEFAULT_AGENTS.forEach(agent => {
    const existing = datasets.aiControl.agents.find(
      entry => matchesTenant(entry.tenantId, tenant) && entry.id === agent.id
    );
    if (!existing) {
      datasets.aiControl.agents.push({ ...agent, tenantId: tenant });
      changed = true;
      return;
    }
    mergeMissingFields(existing, { ...agent, tenantId: tenant });
  });
  return changed;
}

function seedDefaults(tenantId) {
  ensureControlShape();
  const tenant = normalizeTenantId(tenantId);
  const seededProviders = seedProviders(tenant);
  const seededTools = seedToolRegistry(tenant);
  const seededProfiles = seedToolProfiles(tenant);
  const seededAgents = seedAgents(tenant);
  const mutated = seededProviders || seededTools || seededProfiles || seededAgents;
  if (mutated) {
    persist.aiControl(datasets.aiControl);
  }
  return mutated;
}

function listProviders(tenantId) {
  seedDefaults(tenantId);
  const tenant = normalizeTenantId(tenantId);
  return datasets.aiControl.providers
    .filter(provider => matchesTenant(provider.tenantId, tenant))
    .map(provider =>
      safe({
        ...provider,
        defaultModel: provider.defaultModel || provider.model
      })
    );
}

function listToolProfiles(tenantId) {
  seedDefaults(tenantId);
  const tenant = normalizeTenantId(tenantId);
  return datasets.aiControl.toolProfiles.filter(profile => matchesTenant(profile.tenantId, tenant)).map(safe);
}

function toolNamesForProfiles(profileIds = [], tenantId) {
  const tenant = normalizeTenantId(tenantId);
  if (!profileIds.length) return new Set();
  const profiles = datasets.aiControl.toolProfiles.filter(
    profile => matchesTenant(profile.tenantId, tenant) && profileIds.includes(profile.id)
  );
  return new Set(profiles.flatMap(profile => profile.tools || []));
}

function listTools(options = {}) {
  const { tenantId, profileIds = [], role } = options;
  seedDefaults(tenantId);
  const tenant = normalizeTenantId(tenantId);
  const allowedNames = toolNamesForProfiles(profileIds, tenant);
  return datasets.aiControl.toolRegistry
    .filter(tool => matchesTenant(tool.tenantId, tenant))
    .filter(tool => (allowedNames.size ? allowedNames.has(tool.name) : true))
    .filter(tool => {
      if (!tool.allowedRoles || !tool.allowedRoles.length) return true;
      if (!role) return true;
      return tool.allowedRoles.includes(role);
    })
    .map(safe);
}

function listAgents(tenantId) {
  seedDefaults(tenantId);
  const tenant = normalizeTenantId(tenantId);
  return datasets.aiControl.agents.filter(agent => matchesTenant(agent.tenantId, tenant)).map(safe);
}

function getAgent(agentId, tenantId) {
  seedDefaults(tenantId);
  const tenant = normalizeTenantId(tenantId);
  const agent = datasets.aiControl.agents.find(
    entry => matchesTenant(entry.tenantId, tenant) && entry.id === agentId
  );
  return agent ? safe(agent) : null;
}

function formatToolsForProvider(tools = []) {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters || { type: 'object', properties: {} }
    },
    metadata: {
      route: tool.route,
      requiresConfirmation: !!tool.requiresConfirmation
    }
  }));
}

function resolvePromptTemplate(relativePath) {
  if (!relativePath) return '';
  const resolved = path.resolve(ROOT_DIR, relativePath);
  if (!resolved.startsWith(ROOT_DIR)) return '';
  try {
    return fs.readFileSync(resolved, 'utf8');
  } catch (err) {
    return '';
  }
}

function buildAgentToolkit(agentId, tenantId, userRole) {
  seedDefaults(tenantId);
  const tenant = normalizeTenantId(tenantId);
  const agent = datasets.aiControl.agents.find(
    entry => matchesTenant(entry.tenantId, tenant) && entry.id === agentId
  );
  if (!agent) {
    return { error: 'Agent not found' };
  }

  const provider = datasets.aiControl.providers.find(
    entry => matchesTenant(entry.tenantId, tenant) && (entry.id === agent.providerId || entry.provider === agent.providerId)
  );
  const fallbackProvider =
    agent.fallbackProviderId &&
    datasets.aiControl.providers.find(
      entry =>
        matchesTenant(entry.tenantId, tenant) &&
        (entry.id === agent.fallbackProviderId || entry.provider === agent.fallbackProviderId)
    );

  const tools = listTools({
    tenantId: tenant,
    profileIds: agent.toolProfileIds || [],
    role: userRole
  });
  const profiles = listToolProfiles(tenant).filter(profile => (agent.toolProfileIds || []).includes(profile.id));
  return {
    agent: safe(agent),
    provider: provider && safe(provider),
    fallbackProvider: fallbackProvider && safe(fallbackProvider),
    tools,
    toolProfiles: profiles
  };
}

function updateAgent(agentId, payload, tenantId) {
  ensureControlShape();
  const tenant = normalizeTenantId(tenantId);
  const index = datasets.aiControl.agents.findIndex(
    entry => matchesTenant(entry.tenantId, tenant) && entry.id === agentId
  );
  if (index < 0) return { notFound: true };
  const updated = {
    ...datasets.aiControl.agents[index],
    ...payload,
    tenantId: tenant,
    updatedAt: new Date().toISOString()
  };
  datasets.aiControl.agents[index] = updated;
  persist.aiControl(datasets.aiControl);
  return { agent: safe(updated) };
}

function buildPromptPackage(agentId, options = {}) {
  const { tenantId, context = {}, user = {}, subPrompt } = options;
  const toolkit = buildAgentToolkit(agentId, tenantId, user.role || user.userRole);
  if (toolkit.error) return toolkit;

  const systemPrompt = resolvePromptTemplate(toolkit.agent.systemPromptTemplate);
  const sanitizedContext = sanitizePayloadStrings(
    {
      ...context,
      tenantId: normalizeTenantId(tenantId),
      userRole: user.role || user.userRole || context.userRole
    },
    Object.keys(context || {})
  );

  return {
    agent: toolkit.agent,
    provider: toolkit.provider,
    fallbackProvider: toolkit.fallbackProvider,
    tools: toolkit.tools,
    toolProfiles: toolkit.toolProfiles,
    prompt: safe({
      system: systemPrompt,
      guardrails: toolkit.agent.guardrails || DEFAULT_AGENT_GUARDRAILS,
      playbook: toolkit.agent.playbook,
      subPrompt,
      context: sanitizedContext
    }),
    toolSchemas: {
      openai: formatToolsForProvider(toolkit.tools),
      gemini: formatToolsForProvider(toolkit.tools)
    }
  };
}

module.exports = {
  DEFAULT_PROVIDERS,
  DEFAULT_TOOL_REGISTRY,
  DEFAULT_TOOL_PROFILES,
  DEFAULT_AGENTS,
  ensureControlShape,
  seedDefaults,
  listProviders,
  listToolProfiles,
  listTools,
  listAgents,
  getAgent,
  buildAgentToolkit,
  buildPromptPackage,
  updateAgent
};
