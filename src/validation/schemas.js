const { z } = require('./zodLite');
const { VALID_LEAD_STATUSES } = require('../services/leadService');
const { VALID_TASK_STATUSES } = require('../services/taskService');
const { VALID_NOTIFICATION_STATUSES } = require('../services/notificationService');
const { CONTACT_METHODS } = require('../services/customerService');
const { VALID_TICKET_STATUSES } = require('../services/serviceTicketService');
const { ALLOWED_EVENTS } = require('../services/webhookService');

const INVENTORY_CONDITIONS = ['new', 'used', 'demo', 'pending_sale'];
const TRANSFER_STATUSES = ['none', 'requested', 'in_transit', 'arrived'];

const paginationSchema = z.object({
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform(val => (val === undefined ? 25 : Number(val)))
    .refine(val => val === undefined || (Number.isInteger(val) && val >= 0), {
      message: 'limit must be a non-negative integer'
    }),
  offset: z
    .union([z.string(), z.number()])
    .optional()
    .transform(val => (val === undefined ? 0 : Number(val)))
    .refine(val => val === undefined || (Number.isInteger(val) && val >= 0), {
      message: 'offset must be a non-negative integer'
    })
});

const capabilityListQuery = paginationSchema.extend({
  search: z.string().trim().min(1).optional(),
  tenantId: z.string().trim().min(1).optional()
});

const inventoryListQuery = paginationSchema.extend({
  industry: z.string().trim().optional(),
  category: z.string().trim().optional(),
  subcategory: z.string().trim().optional(),
  condition: z.enum(INVENTORY_CONDITIONS).optional(),
  location: z.string().trim().optional(),
  transferStatus: z.enum(TRANSFER_STATUSES).optional(),
  featured: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform(val => {
      if (val === undefined) return undefined;
      if (typeof val === 'boolean') return val;
      return val.toLowerCase() === 'true';
    }),
  minPrice: z
    .union([z.string(), z.number()])
    .optional()
    .transform(val => (val === undefined ? undefined : Number(val))),
  maxPrice: z
    .union([z.string(), z.number()])
    .optional()
    .transform(val => (val === undefined ? undefined : Number(val))),
  search: z.string().trim().min(1).optional(),
  sortBy: z.enum(['createdAt', 'price', 'msrp', 'daysOnLot']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  tenantId: z.string().trim().min(1).optional()
});

const spotlight = z.object({
  id: z.string().trim().optional(),
  title: z.string().trim(),
  description: z.string().trim(),
  valueTag: z.string().trim().optional(),
  priority: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? 0 : Number(val)))
});

const mediaHotspot = z.object({
  id: z.string().trim().optional(),
  mediaId: z.string().trim().optional(),
  x: z.number().refine(val => val >= 0 && val <= 1, { message: 'x must be between 0 and 1' }),
  y: z.number().refine(val => val >= 0 && val <= 1, { message: 'y must be between 0 and 1' }),
  label: z.string().trim(),
  description: z.string().trim().optional()
});

const mediaPhoto = z.object({
  id: z.string().trim().optional(),
  url: z.string().url(),
  width: z.number().optional(),
  height: z.number().optional(),
  isHero: z.boolean().optional(),
  optimizedUrl: z.string().url().optional(),
  placeholderUrl: z.string().optional(),
  priority: z.boolean().optional(),
  fullWidthPreferred: z.boolean().optional()
});

const mediaHeroVideo = z.object({
  id: z.string().trim().optional(),
  url: z.string().url(),
  autoplayLoop: z.boolean().optional(),
  durationSeconds: z.number().optional()
});

const mediaVirtualTour = z.object({
  provider: z.string().trim().optional(),
  url: z.string().url(),
  embedCode: z.string().trim().optional()
});

const mediaSchema = z.object({
  photos: z.array(mediaPhoto).optional(),
  heroVideo: mediaHeroVideo.optional(),
  virtualTour: mediaVirtualTour.optional()
});

const inventoryBase = z.object({
  stockNumber: z.string().trim(),
  vin: z
    .string()
    .trim()
    .min(11)
    .max(17)
    .transform(val => val.toUpperCase()),
  name: z.string().trim(),
  condition: z.enum(INVENTORY_CONDITIONS),
  price: z.union([z.number(), z.string()]).transform(val => Number(val)),
  msrp: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  salePrice: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  rebates: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  fees: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  taxes: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  year: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  length: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  weight: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  chassis: z.string().trim().optional(),
  industry: z.string().trim().optional(),
  category: z.string().trim().optional(),
  subcategory: z.string().trim().optional(),
  location: z.string().trim().optional(),
  lotCode: z.string().trim().optional(),
  transferStatus: z.enum(TRANSFER_STATUSES).optional(),
  holdUntil: z.string().trim().optional(),
  daysOnLot: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  images: z.array(z.string().url()).optional(),
  floorplans: z.array(z.string().url()).optional(),
  virtualTours: z.array(z.string().url()).optional(),
  videoLinks: z.array(z.string().url()).optional(),
  featured: z.boolean().optional(),
  description: z.string().trim().optional(),
  slug: z.string().trim().min(3).optional(),
  metaTitle: z.string().trim().optional(),
  metaDescription: z.string().trim().optional(),
  salesStory: z.string().trim().max(4000).optional(),
  spotlights: z.array(spotlight).optional(),
  mediaHotspots: z.array(mediaHotspot).optional(),
  badges: z.array(z.string().trim()).optional(),
  media: mediaSchema.optional()
});

const inventoryCreate = inventoryBase;
const inventoryUpdate = inventoryBase.partial();
const inventoryFeatureUpdate = z.object({ featured: z.boolean() });
const inventoryStoryUpdate = z.object({ salesStory: z.string().trim().max(4000) });
const inventorySpotlightsUpdate = z.object({ spotlights: z.array(spotlight) });
const inventoryHotspotsUpdate = z.object({ mediaHotspots: z.array(mediaHotspot) });
const inventoryMediaUpdate = z.object({ media: mediaSchema });
const inventoryBulkImport = z.object({
  csv: z.string().trim().min(1),
  tenantId: z.string().trim().min(1).optional()
});
const badgeRule = z.object({
  label: z.string().trim(),
  matchField: z.string().trim(),
  matchValue: z.union([z.string(), z.number()])
});
const badgeRulesUpdate = z.object({
  nationalParkMaxLength: z.union([z.number(), z.string()]).optional(),
  offGridEnabled: z.boolean().optional(),
  customRules: z.array(badgeRule).optional()
});
const badgePreview = inventoryBase.partial();

const spotlightTemplateCreate = z.object({
  name: z.string().trim(),
  description: z.string().trim().optional(),
  spotlights: z.array(spotlight)
});
const spotlightTemplateUpdate = spotlightTemplateCreate.partial();
const spotlightTemplateApply = z.object({
  templateId: z.string().trim(),
  inventoryIds: z.array(z.string().trim())
});
const badgeRecompute = z
  .object({
    inventoryIds: z.array(z.string().trim()).optional(),
    all: z.boolean().optional()
  })
  .refine(body => body.all || (body.inventoryIds && body.inventoryIds.length > 0), {
    message: 'Provide inventoryIds or set all to true'
  });

const teamMember = z.object({
  firstName: z.string().trim(),
  lastName: z.string().trim(),
  jobRole: z.string().trim(),
  biography: z.string().trim().optional(),
  socialLinks: z.array(z.string().url()).optional()
});

const teamCreate = z.object({
  name: z.string().trim(),
  members: z.array(teamMember).optional()
});
const teamUpdate = teamCreate.partial();

const reviewCreate = z.object({
  name: z.string().trim(),
  rating: z
    .union([z.number(), z.string()])
    .transform(val => Number(val))
    .refine(val => val >= 1 && val <= 5, { message: 'Rating must be between 1 and 5' }),
  content: z.string().trim(),
  visible: z.boolean().optional()
});
const reviewUpdate = reviewCreate.partial();
const reviewVisibilityUpdate = z.object({ visible: z.boolean() });

const leadCreate = z.object({
  name: z.string().trim(),
  email: z.string().trim().email(),
  message: z.string().trim(),
  subject: z.string().trim().optional(),
  status: z.enum(VALID_LEAD_STATUSES).optional(),
  interestedStockNumber: z.string().trim().optional(),
  assignedTo: z.string().trim().optional(),
  dueDate: z.string().trim().optional(),
  lastContactedAt: z.string().trim().optional(),
  utmSource: z.string().trim().optional(),
  utmMedium: z.string().trim().optional(),
  utmCampaign: z.string().trim().optional(),
  utmTerm: z.string().trim().optional(),
  referrer: z.string().trim().optional()
});
const leadUpdate = leadCreate.partial();
const leadStatusUpdate = z.object({ status: z.enum(VALID_LEAD_STATUSES) });
const leadListQuery = z.object({
  status: z.enum(VALID_LEAD_STATUSES).optional(),
  assignedTo: z.enum(['admin', 'sales', 'marketing']).optional(),
  sortBy: z.enum(['createdAt', 'name', 'dueDate', 'lastContactedAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  tenantId: z.string().trim().min(1).optional()
});

const leadScoreRecompute = z
  .object({
    leadIds: z.array(z.string().trim()).optional(),
    all: z.boolean().optional()
  })
  .refine(val => val.all || (val.leadIds && val.leadIds.length > 0), {
    message: 'Provide leadIds or set all=true'
  });

const leadScoringRulesUpdate = z.object({
  baseScore: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  repeatViewWeight: z
    .union([z.number(), z.string()])
    .optional()
    .transform(val => (val === undefined ? undefined : Number(val))),
  highValuePriceThreshold: z
    .union([z.number(), z.string()])
    .optional()
    .transform(val => (val === undefined ? undefined : Number(val))),
  highValueScore: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  engagementDurationMs: z
    .union([z.number(), z.string()])
    .optional()
    .transform(val => (val === undefined ? undefined : Number(val))),
  scrollDepthThreshold: z
    .union([z.number(), z.string()])
    .optional()
    .transform(val => (val === undefined ? undefined : Number(val))),
  engagementScore: z
    .union([z.number(), z.string()])
    .optional()
    .transform(val => (val === undefined ? undefined : Number(val))),
  engagementCap: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  submissionScore: z
    .union([z.number(), z.string()])
    .optional()
    .transform(val => (val === undefined ? undefined : Number(val))),
  alertEngagementScore: z
    .union([z.number(), z.string()])
    .optional()
    .transform(val => (val === undefined ? undefined : Number(val))),
  alertCap: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  segmentRules: z
    .array(
      z.object({
        id: z.string().trim(),
        minScore: z.union([z.number(), z.string()]).transform(val => Number(val))
      })
    )
    .optional(),
  tenantId: z.string().trim().optional()
});

const customerCreate = z.object({
  firstName: z.string().trim(),
  lastName: z.string().trim(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().optional(),
  preferredContactMethod: z.enum(CONTACT_METHODS).optional(),
  marketingOptIn: z.boolean().optional(),
  notes: z.string().trim().optional()
});
const customerUpdate = customerCreate.partial();
const customerListQuery = paginationSchema.extend({
  search: z.string().trim().optional(),
  marketingOptIn: z.boolean().optional(),
  tenantId: z.string().trim().min(1).optional()
});

const lineItem = z.object({
  description: z.string().trim(),
  laborHours: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  partsCost: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val)))
});

const serviceTicketCreate = z.object({
  customerId: z.string().trim(),
  unitId: z.string().trim().optional(),
  status: z.enum(VALID_TICKET_STATUSES).optional(),
  concern: z.string().trim(),
  scheduledDate: z.string().trim().optional(),
  technician: z.string().trim().optional(),
  warranty: z.boolean().optional(),
  lineItems: z.array(lineItem).optional()
});

const serviceTicketUpdate = serviceTicketCreate.partial();
const serviceTicketListQuery = paginationSchema.extend({
  status: z.enum(VALID_TICKET_STATUSES).optional(),
  customerId: z.string().trim().optional(),
  tenantId: z.string().trim().min(1).optional()
});

const financeOfferCreate = z.object({
  lender: z.string().trim(),
  termMonths: z.union([z.number(), z.string()]).transform(val => Number(val)),
  apr: z.union([z.number(), z.string()]).transform(val => Number(val)),
  downPayment: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  restrictions: z.string().trim().optional(),
  vehicleCategory: z.string().trim().optional()
});

const financeOfferUpdate = financeOfferCreate.partial();
const financeOfferListQuery = paginationSchema.extend({
  vehicleCategory: z.string().trim().optional(),
  tenantId: z.string().trim().min(1).optional()
});

const contentPageCreate = z.object({
  title: z.string().trim(),
  body: z.string().trim(),
  slug: z.string().trim().optional(),
  metaTitle: z.string().trim().optional(),
  metaDescription: z.string().trim().optional(),
  status: z.enum(['draft', 'scheduled', 'published']).optional(),
  publishAt: z.string().trim().optional(),
  topic: z.string().trim().optional(),
  relatedTopics: z.array(z.string().trim()).optional()
});

const contentPageUpdate = contentPageCreate.partial();

const pagePublish = z.object({
  publishAt: z.string().trim().optional()
});

const eventCreate = z.object({
  type: z.enum(['search', 'view', 'lead_submit']),
  stockNumber: z.string().trim().optional(),
  leadId: z.string().trim().optional(),
  query: z.string().trim().optional(),
  referrer: z.string().trim().optional(),
  interaction: z.string().trim().optional(),
  section: z.string().trim().optional(),
  durationMs: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  scrollDepth: z
    .union([z.number(), z.string()])
    .optional()
    .transform(val => (val === undefined ? undefined : Number(val))),
  utmSource: z.string().trim().optional(),
  utmMedium: z.string().trim().optional(),
  utmCampaign: z.string().trim().optional()
});

const settingsUpdate = z.object({
  dealershipName: z.string().trim(),
  phone: z.string().trim(),
  email: z.string().trim().email().optional(),
  address: z.string().trim().optional(),
  hours: z
    .object({
      sales: z.string().trim().optional(),
      service: z.string().trim().optional(),
      parts: z.string().trim().optional()
    })
    .optional()
});

const idParam = z.object({ id: z.string().trim().min(1) });
const inventoryId = idParam;

const authLogin = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(6),
  tenantId: z.string().trim().min(1).optional()
});

const authRefresh = z.object({
  refreshToken: z.string().trim().min(10).optional()
});

const authLogout = authRefresh;

const seoProfileUpsert = z.object({
  resourceType: z.enum(['inventory', 'content', 'custom']),
  resourceId: z.string().trim(),
  metaTitle: z.string().trim().optional(),
  metaDescription: z.string().trim().optional(),
  canonicalUrl: z.string().trim().optional(),
  ogTitle: z.string().trim().optional(),
  ogDescription: z.string().trim().optional(),
  ogImage: z.string().trim().optional(),
  focusKeywords: z.array(z.string().trim()).optional(),
  schemaMarkup: z.any().optional(),
  noindex: z.boolean().optional(),
  nofollow: z.boolean().optional(),
  tenantId: z.string().trim().min(1).optional()
});

const analyticsEvent = z.object({
  type: z.string().trim().min(1),
  resourceType: z.string().trim().optional(),
  resourceId: z.string().trim().optional(),
  channel: z.string().trim().optional(),
  note: z.string().trim().optional(),
  metrics: z.any().optional(),
  experimentId: z.string().trim().optional(),
  variantId: z.string().trim().optional(),
  tenantId: z.string().trim().min(1).optional()
});

const pageLayoutUpsert = z.object({
  title: z.string().trim().optional(),
  theme: z.string().trim().optional(),
  note: z.string().trim().optional(),
  blocks: z.array(z.any()).optional(),
  widgets: z.array(z.any()).optional(),
  tenantId: z.string().trim().min(1).optional()
});

const blockPresetCreate = z.object({
  type: z.string().trim(),
  label: z.string().trim(),
  props: z.any().optional()
});

const blockPresetUpdate = blockPresetCreate.partial();

const experimentVariant = z.object({
  id: z.string().trim().optional(),
  weight: z.union([z.number(), z.string()]).optional(),
  pageIdOrBlockConfig: z.any().optional(),
  label: z.string().trim().optional()
});

const experimentCreate = z.object({
  name: z.string().trim(),
  targetSlug: z.string().trim(),
  variantType: z.enum(['page', 'block']),
  status: z.enum(['draft', 'running', 'stopped']).optional(),
  variants: z.array(experimentVariant),
  metrics: z.array(z.string().trim()).optional()
});

const experimentUpdate = experimentCreate.partial();

const aiProviderCreate = z.object({
  name: z.string().trim().optional(),
  provider: z.string().trim().optional(),
  model: z.string().trim().optional(),
  apiBase: z.string().trim().optional(),
  note: z.string().trim().optional(),
  tenantId: z.string().trim().min(1).optional()
});

const aiObservationCreate = z.object({
  kind: z.string().trim().optional(),
  message: z.string().trim().optional(),
  resourceType: z.string().trim().optional(),
  resourceId: z.string().trim().optional(),
  tenantId: z.string().trim().min(1).optional()
});

const aiWebFetchRequest = z.object({
  url: z.string().trim().url(),
  note: z.string().trim().optional(),
  tenantId: z.string().trim().min(1).optional()
});

const aiVoiceSettingsUpdate = z.object({
  enabled: z.boolean().optional(),
  playbackEnabled: z.boolean().optional(),
  micEnabled: z.boolean().optional(),
  voiceName: z.string().trim().optional(),
  tenantId: z.string().trim().min(1).optional()
});

const vehicleDraft = inventoryBase.partial();

const aiTask = z.object({
  title: z.string().trim(),
  notes: z.string().trim().optional(),
  autoComplete: z.boolean().optional()
});

const aiAssistantSessionCreate = z.object({
  channel: z.enum(['chat', 'voice']).optional(),
  entrypoint: z.string().trim().optional(),
  voiceEnabled: z.boolean().optional(),
  micEnabled: z.boolean().optional(),
  vehicleDraft: vehicleDraft.optional(),
  tenantId: z.string().trim().min(1).optional()
});

const aiAssistantMessage = z.object({
  message: z.string().trim().optional(),
  intent: z.enum(['add_vehicle', 'status', 'general', 'task_runner', 'toolkit', 'inspect_code']).optional(),
  micActive: z.boolean().optional(),
  vehicleDraft: vehicleDraft.optional(),
  tasks: z.array(aiTask).optional(),
  planName: z.string().trim().optional(),
  tenantId: z.string().trim().min(1).optional()
});

const aiAutomationPlanCreate = z.object({
  name: z.string().trim().optional(),
  tasks: z.array(aiTask),
  sessionId: z.string().trim().optional(),
  tenantId: z.string().trim().min(1).optional()
});

const webhookCreate = z.object({
  url: z.string().trim().url(),
  description: z.string().trim().optional(),
  eventTypes: z.array(z.enum(ALLOWED_EVENTS)).optional(),
  headers: z.any().optional(),
  secret: z.string().trim().optional(),
  active: z.boolean().optional(),
  tenantId: z.string().trim().min(1).optional()
});

const webhookUpdate = webhookCreate.partial();

const webhookDeliveryQuery = z.object({
  webhookId: z.string().trim().optional(),
  eventType: z.enum(ALLOWED_EVENTS).optional(),
  limit: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? 50 : Number(val)))
});

const taskCreate = z.object({
  title: z.string().trim(),
  notes: z.string().trim().optional(),
  contactId: z.string().trim().optional(),
  assignedTo: z.string().trim().optional(),
  status: z.enum(VALID_TASK_STATUSES).optional(),
  dueAt: z.string().trim().optional(),
  tenantId: z.string().trim().min(1).optional()
});

const taskUpdate = taskCreate.partial();

const taskListQuery = z.object({
  status: z.enum(VALID_TASK_STATUSES).optional(),
  assignedTo: z.string().trim().optional(),
  contactId: z.string().trim().optional(),
  dueFrom: z.string().trim().optional(),
  dueTo: z.string().trim().optional()
});

const notificationStatusUpdate = z.object({ status: z.enum(VALID_NOTIFICATION_STATUSES) });

const notificationListQuery = z.object({
  status: z.enum(VALID_NOTIFICATION_STATUSES).optional(),
  contactId: z.string().trim().optional()
});

const webhookListQuery = z.object({
  eventType: z.enum(ALLOWED_EVENTS).optional(),
  active: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform(val => {
      if (val === undefined) return undefined;
      if (typeof val === 'boolean') return val;
      return val.toLowerCase() === 'true';
    })
});

const redirectCreate = z.object({
  sourcePath: z.string().trim().min(1),
  targetPath: z.string().trim().min(1),
  statusCode: z
    .union([z.number(), z.string()])
    .optional()
    .transform(val => (val === undefined ? undefined : Number(val)))
    .refine(val => val === undefined || val === 301 || val === 302, { message: 'statusCode must be 301 or 302' }),
  createdBy: z.string().trim().optional(),
  tenantId: z.string().trim().min(1).optional()
});

const campaignCreate = z.object({
  name: z.string().trim(),
  slug: z.string().trim(),
  channel: z.string().trim(),
  startAt: z.string().trim().optional(),
  endAt: z.string().trim().optional(),
  targetLandingPageSlug: z.string().trim().optional(),
  utmSource: z.string().trim().optional(),
  utmMedium: z.string().trim().optional(),
  utmCampaign: z.string().trim().optional(),
  tenantId: z.string().trim().optional()
});

const campaignUpdate = campaignCreate.partial();

const auditLogQuery = z.object({
  tenantId: z.string().trim().optional(),
  entity: z.string().trim().optional(),
  since: z.string().trim().optional(),
  limit: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? 100 : Number(val)))
});

module.exports = {
  schemas: {
    capabilityListQuery,
    inventoryListQuery,
    inventoryCreate,
    inventoryUpdate,
    inventoryFeatureUpdate,
    inventoryBulkImport,
    inventoryStoryUpdate,
    inventorySpotlightsUpdate,
    inventoryHotspotsUpdate,
    inventoryMediaUpdate,
    badgeRulesUpdate,
    badgePreview,
    spotlightTemplateCreate,
    spotlightTemplateUpdate,
    spotlightTemplateApply,
    badgeRecompute,
    teamCreate,
    teamUpdate,
    reviewCreate,
    reviewUpdate,
    reviewVisibilityUpdate,
    leadCreate,
    leadUpdate,
    leadListQuery,
    leadStatusUpdate,
    leadScoreRecompute,
    leadScoringRulesUpdate,
    customerCreate,
    customerUpdate,
    customerListQuery,
    serviceTicketCreate,
    serviceTicketUpdate,
    serviceTicketListQuery,
    financeOfferCreate,
    financeOfferUpdate,
    financeOfferListQuery,
    settingsUpdate,
    contentPageCreate,
    contentPageUpdate,
    pagePublish,
    eventCreate,
    idParam,
    inventoryId,
    authLogin,
    authRefresh,
    authLogout,
    seoProfileUpsert,
    analyticsEvent,
    pageLayoutUpsert,
    blockPresetCreate,
    blockPresetUpdate,
    experimentCreate,
    experimentUpdate,
    aiProviderCreate,
    aiObservationCreate,
    aiWebFetchRequest,
    aiAutomationPlanCreate,
    webhookCreate,
    webhookUpdate,
    webhookListQuery,
    webhookDeliveryQuery,
    auditLogQuery,
    redirectCreate,
    campaignCreate,
    campaignUpdate,
    taskCreate,
    taskUpdate,
    taskListQuery,
    notificationStatusUpdate,
    notificationListQuery,
    aiVoiceSettingsUpdate,
    aiAssistantSessionCreate,
    aiAssistantMessage
  },
  constants: {
    INVENTORY_CONDITIONS,
    TRANSFER_STATUSES
  }
};
