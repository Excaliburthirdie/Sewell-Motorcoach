const { z } = require('./zodLite');
const { VALID_LEAD_STATUSES } = require('../services/leadService');

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

const INVENTORY_CONDITIONS = ['new', 'used', 'demo', 'pending_sale'];

const inventoryListQuery = paginationSchema.extend({
  industry: z.string().trim().optional(),
  category: z.string().trim().optional(),
  subcategory: z.string().trim().optional(),
  condition: z.enum(INVENTORY_CONDITIONS).optional(),
  location: z.string().trim().optional(),
  transferStatus: z.enum(['available', 'in_transit', 'on_hold']).optional(),
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
  transferStatus: z.enum(['available', 'in_transit', 'on_hold']).optional(),
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
  metaDescription: z.string().trim().optional()
});

const inventoryCreate = inventoryBase;
const inventoryUpdate = inventoryBase.partial();
const inventoryFeatureUpdate = z.object({ featured: z.boolean() });
const inventoryBulkImport = z.object({
  csv: z.string().trim().min(1),
  tenantId: z.string().trim().min(1).optional()
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

module.exports = {
  schemas: {
    capabilityListQuery,
    inventoryListQuery,
    inventoryCreate,
    inventoryUpdate,
    inventoryFeatureUpdate,
    inventoryBulkImport,
    teamCreate,
    teamUpdate,
    reviewCreate,
    reviewUpdate,
    reviewVisibilityUpdate,
    leadCreate,
    leadUpdate,
    leadListQuery,
    leadStatusUpdate,
    settingsUpdate,
    idParam,
    inventoryId,
    authLogin,
    authRefresh
  },
  constants: {
    INVENTORY_CONDITIONS
  }
};
