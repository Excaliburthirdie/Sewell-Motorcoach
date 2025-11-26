const { z } = require('./zodLite');
const { VALID_LEAD_STATUSES } = require('../services/leadService');

const paginationSchema = z.object({
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform(val => (val === undefined ? undefined : Number(val)))
    .refine(val => val === undefined || (Number.isInteger(val) && val >= 0), {
      message: 'limit must be a non-negative integer'
    }),
  offset: z
    .union([z.string(), z.number()])
    .optional()
    .transform(val => (val === undefined ? undefined : Number(val)))
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
  condition: z.string().trim().optional(),
  location: z.string().trim().optional(),
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
  name: z.string().trim(),
  condition: z.string().trim(),
  price: z.union([z.number(), z.string()]).transform(val => Number(val)),
  msrp: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  salePrice: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  industry: z.string().trim().optional(),
  category: z.string().trim().optional(),
  subcategory: z.string().trim().optional(),
  location: z.string().trim().optional(),
  daysOnLot: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  images: z.array(z.string().url()).optional(),
  featured: z.boolean().optional(),
  description: z.string().trim().optional()
});

const inventoryCreate = inventoryBase;
const inventoryUpdate = inventoryBase.partial();
const inventoryFeatureUpdate = z.object({ featured: z.boolean() });

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
  interestedStockNumber: z.string().trim().optional()
});
const leadUpdate = leadCreate.partial();
const leadStatusUpdate = z.object({ status: z.enum(VALID_LEAD_STATUSES) });
const leadListQuery = z.object({
  status: z.enum(VALID_LEAD_STATUSES).optional(),
  sortBy: z.enum(['createdAt', 'name']).optional(),
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
    authLogin,
    authRefresh
  }
};
