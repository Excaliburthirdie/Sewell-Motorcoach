const { z } = require('./zodLite');
const { VALID_LEAD_STATUSES } = require('../services/leadService');

const VALID_INVENTORY_CONDITIONS = ['New', 'Used', 'Demo', 'Pending Sale', 'On Order'];
const VALID_LOCATION_STATUSES = ['On Lot', 'On Hold', 'Transfer Pending', 'In Transfer'];

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
  condition: z.enum(VALID_INVENTORY_CONDITIONS).optional(),
  lotId: z.string().trim().optional(),
  locationStatus: z.enum(VALID_LOCATION_STATUSES).optional(),
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
  sortBy: z.enum(['createdAt', 'price', 'msrp', 'daysOnLot', 'year']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  tenantId: z.string().trim().min(1).optional()
});

const feeItem = z.object({
  type: z.string().trim(),
  amount: z.union([z.number(), z.string()]).transform(val => Number(val))
});

const inventoryBase = z.object({
  stockNumber: z.string().trim(),
  name: z.string().trim(),
  vin: z
    .string()
    .trim()
    .min(11)
    .max(17),
  year: z
    .union([z.number(), z.string()])
    .transform(val => Number(val))
    .refine(val => val >= 1980 && val <= 2100, { message: 'year must be reasonable' }),
  condition: z.enum(VALID_INVENTORY_CONDITIONS),
  price: z.union([z.number(), z.string()]).transform(val => Number(val)),
  msrp: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  salePrice: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  rebates: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? 0 : Number(val))),
  taxes: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? 0 : Number(val))),
  fees: z.array(feeItem).optional(),
  length: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  weight: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  chassis: z.string().trim().optional(),
  industry: z.string().trim().optional(),
  category: z.string().trim().optional(),
  subcategory: z.string().trim().optional(),
  lotId: z.string().trim().optional(),
  locationStatus: z.enum(VALID_LOCATION_STATUSES).optional(),
  location: z.string().trim().optional(),
  daysOnLot: z.union([z.number(), z.string()]).optional().transform(val => (val === undefined ? undefined : Number(val))),
  images: z.array(z.string().url()).optional(),
  featured: z.boolean().optional(),
  description: z.string().trim().optional()
});

const inventoryCreate = inventoryBase;
const inventoryUpdate = inventoryBase.partial();
const inventoryFeatureUpdate = z.object({ featured: z.boolean() });
const inventoryLocationUpdate = z.object({
  location: z.string().trim(),
  lotId: z.string().trim().optional(),
  locationStatus: z.enum(VALID_LOCATION_STATUSES).optional()
});
const inventoryHoldUpdate = z.object({
  hold: z.boolean(),
  reason: z.string().trim().optional(),
  holdUntil: z.string().trim().optional()
});
const inventoryTransferUpdate = z.object({
  toLotId: z.string().trim(),
  toLocation: z.string().trim(),
  status: z.enum(['Transfer Pending', 'In Transfer', 'Received']).optional()
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

const consentDetails = z.object({
  marketing: z.boolean(),
  privacyPolicyVersion: z.string().trim().optional(),
  termsAcceptedAt: z.string().trim().optional(),
  consentSource: z.string().trim().optional(),
  timestamp: z.string().trim().optional(),
  ip: z.string().trim().optional(),
  userAgent: z.string().trim().optional()
});

const leadCreate = z.object({
  name: z.string().trim(),
  email: z.string().trim().email(),
  message: z.string().trim(),
  subject: z.string().trim().optional(),
  status: z.enum(VALID_LEAD_STATUSES).optional(),
  interestedStockNumber: z.string().trim().optional(),
  consent: consentDetails.optional()
});
const leadUpdate = leadCreate.partial();
const leadStatusUpdate = z.object({ status: z.enum(VALID_LEAD_STATUSES) });
const leadListQuery = z.object({
  status: z.enum(VALID_LEAD_STATUSES).optional(),
  sortBy: z.enum(['createdAt', 'name']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  tenantId: z.string().trim().min(1).optional(),
  maskPII: z.boolean().optional()
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
  refreshToken: z.string().trim().min(10)
});

module.exports = {
  schemas: {
    capabilityListQuery,
    inventoryListQuery,
    inventoryCreate,
    inventoryUpdate,
    inventoryFeatureUpdate,
    inventoryLocationUpdate,
    inventoryHoldUpdate,
    inventoryTransferUpdate,
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
