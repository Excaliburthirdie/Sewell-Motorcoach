const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const config = require('./src/config');
const { DATA_DIR } = require('./src/persistence/store');
const capabilityService = require('./src/services/capabilityService');
const inventoryService = require('./src/services/inventoryService');
const teamService = require('./src/services/teamService');
const reviewService = require('./src/services/reviewService');
const leadService = require('./src/services/leadService');
const settingsService = require('./src/services/settingsService');
const authService = require('./src/services/authService');
const { datasets, persist } = require('./src/services/state');
const tenantService = require('./src/services/tenantService');
const { sanitizeMiddleware } = require('./src/middleware/sanitize');
const { validateBody, validateParams, validateQuery } = require('./src/middleware/validation');
const { schemas } = require('./src/validation/schemas');
const { AppError, errorHandler } = require('./src/middleware/errors');
const { csrfProtection, ensureCsrfToken } = require('./src/middleware/csrf');
const retentionService = require('./src/services/retentionService');
const { maskForLogs, maskForResponse } = require('./src/services/pii');

tenantService.initializeTenants();

const app = express();
const port = config.server.port;
const API_KEY = config.auth.apiKey;
const RATE_LIMIT_WINDOW_MS = config.rateLimit.windowMs;
const RATE_LIMIT_MAX = config.rateLimit.max;
const { datasets } = require('./src/services/state');
const tenantService = require('./src/services/tenantService');
const { validateBody, validateParams, validateQuery } = require('./src/middleware/validation');
const { schemas } = require('./src/validation/schemas');
const { AppError, errorHandler } = require('./src/middleware/errors');

tenantService.initializeTenants();

const app = express();
const port = config.server.port;
const API_KEY = config.auth.apiKey;
const RATE_LIMIT_WINDOW_MS = config.rateLimit.windowMs;
const RATE_LIMIT_MAX = config.rateLimit.max;
const { datasets } = require('./src/services/state');

const app = express();
const port = process.env.PORT || 3000;
const DATA_DIR = `${__dirname}/data`;
const VALID_LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];
const API_KEY = process.env.API_KEY || process.env.ADMIN_API_KEY;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 300);

const rateLimitBuckets = new Map();

app.use(bodyParser.json());
app.use(cors({ origin: true, credentials: true, exposedHeaders: ['X-Request-Id', 'X-CSRF-Token'] }));
app.use(sanitizeMiddleware);

// Core middleware stack ----------------------------------------------------
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  res.set('X-Request-Id', requestId);
  next();
});

app.use((req, res, next) => {
  const rawTenantId = req.headers['x-tenant-id'] || req.query.tenantId || (req.body && req.body.tenantId);
  const resolved = tenantService.resolveTenantId(rawTenantId || tenantService.DEFAULT_TENANT_ID);
  if (!resolved) {
    return next(new AppError('TENANT_NOT_FOUND', 'Tenant not found', 404));
  }
  req.tenant = tenantService.getTenant(resolved);
  return next();
});

// Core middleware stack ----------------------------------------------------
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  res.set('X-Request-Id', requestId);
  next();
});

app.use((req, res, next) => {
  const rawTenantId = req.headers['x-tenant-id'] || req.query.tenantId || (req.body && req.body.tenantId);
  const resolved = tenantService.resolveTenantId(rawTenantId || tenantService.DEFAULT_TENANT_ID);
  if (!resolved) {
    return next(new AppError('TENANT_NOT_FOUND', 'Tenant not found', 404));
  }
  req.tenant = tenantService.getTenant(resolved);
  return next();
});

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const log = {
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs
    };
    console.log(JSON.stringify(log));
  const startedAt = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    console.log(
      JSON.stringify({
        level: 'info',
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs
      })
    );
  });
  next();
});

app.use((req, res, next) => {
  if (config.server.enforceHttps && req.headers['x-forwarded-proto'] === 'http') {
    return next(new AppError('HTTPS_REQUIRED', 'HTTPS is required', 400));
  }
  if (config.server.enforceHttps || req.headers['x-forwarded-proto'] === 'https') {
    res.set('Strict-Transport-Security', `max-age=${config.server.hstsMaxAgeSeconds}; includeSubDomains`);
  if (process.env.ENFORCE_HTTPS === 'true' && req.headers['x-forwarded-proto'] === 'http') {
    return res.status(400).json({ message: 'HTTPS is required' });
  }
  next();
});

app.use(csrfProtection);

app.use((req, res, next) => {
  const now = Date.now();
  const bucket = (rateLimitBuckets.get(req.ip) || []).filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);
  bucket.push(now);
  rateLimitBuckets.set(req.ip, bucket);

  if (bucket.length > RATE_LIMIT_MAX) {
    return next(new AppError('RATE_LIMIT_EXCEEDED', 'Rate limit exceeded', 429));
    return res.status(429).json({ message: 'Rate limit exceeded' });
  }
  next();
});

// Utility helpers ----------------------------------------------------------
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (API_KEY && header === `Bearer ${API_KEY}`) {
    req.user = { id: 'api-key', role: 'admin', username: 'api-key', authType: 'api-key', tenantId: req.tenant.id };
    return next();
  }

  if (!bearer) {
    return next(new AppError('UNAUTHORIZED', 'Unauthorized: missing bearer token', 401));
  }

  try {
    const payload = authService.verifyAccessToken(bearer);
    if (req.tenant && payload.tenantId && payload.tenantId !== req.tenant.id) {
      return next(new AppError('TENANT_MISMATCH', 'Token tenant does not match requested tenant', 403));
    }
    req.user = { id: payload.sub, username: payload.username, role: payload.role, authType: 'jwt', tenantId: payload.tenantId };
    return next();
  } catch (err) {
    return next(new AppError('UNAUTHORIZED', err.message || 'Unauthorized', 401));
// Shared helpers -----------------------------------------------------------

app.use((req, res, next) => {
  if (process.env.ENFORCE_HTTPS === 'true' && req.headers['x-forwarded-proto'] === 'http') {
    return res.status(400).json({ message: 'HTTPS is required' });
  }
  next();
});

function authorize(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return next(new AppError('FORBIDDEN', 'Forbidden: missing user context', 403));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('FORBIDDEN', 'Forbidden: insufficient role', 403));
    }
    return next();
  };
}

function authorize(allowedRoles = []) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return next(new AppError('FORBIDDEN', 'Forbidden: missing user context', 403));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('FORBIDDEN', 'Forbidden: insufficient role', 403));
    }
    return next();
  };
}

function auditChange(req, action, entity, payload, metadata = {}) {
  const auditPayload = maskForLogs(payload, {
    enabled: config.pii.maskLogs,
    replacement: config.pii.replacement,
    sensitiveKeys: config.pii.sensitiveKeys
  });
  const auditMetadata = maskForLogs(metadata, {
    enabled: config.pii.maskLogs,
    replacement: config.pii.replacement,
    sensitiveKeys: config.pii.sensitiveKeys
  });
  const auditRecord = {
    timestamp: new Date().toISOString(),
    requestId: requestId(req),
    tenantId: req.tenant?.id,
    user: req.user ? { id: req.user.id, role: req.user.role, username: req.user.username } : undefined,
    ip: req.ip,
    action,
    entity,
    payload: auditPayload,
    metadata: auditMetadata
  };
  fs.appendFile(`${DATA_DIR}/audit.log`, `${JSON.stringify(auditRecord)}\n`, () => {});
}

function hasPriceChange(previous, updated) {
  if (!previous || !updated) return false;
  const basicFields = ['price', 'msrp', 'salePrice', 'rebates', 'taxes'];
  const feesChanged = JSON.stringify(previous.fees || []) !== JSON.stringify(updated.fees || []);
  return basicFields.some(field => previous[field] !== updated[field]) || feesChanged;
}

function auditPricingChange(req, previous, updated) {
  if (!hasPriceChange(previous, updated)) return;
  auditChange(
    req,
    'pricing_change',
    'inventory',
    {
      id: updated.id,
      stockNumber: updated.stockNumber,
      previousPrice: previous.price,
      newPrice: updated.price,
      previousMsrp: previous.msrp,
      newMsrp: updated.msrp,
      previousSalePrice: previous.salePrice,
      newSalePrice: updated.salePrice,
      previousRebates: previous.rebates,
      newRebates: updated.rebates,
      previousTaxes: previous.taxes,
      newTaxes: updated.taxes,
      previousFees: previous.fees,
      newFees: updated.fees
    },
    { changeType: 'sensitive_pricing' }
  );
}

function maskForExport(data, req) {
  const shouldMask = config.pii.maskExports || req.headers['x-mask-pii'] === 'true';
  const queryMask = req.validated?.query && req.validated.query.maskPII;
  const enabled = shouldMask || Boolean(queryMask);
  return maskForResponse(data, {
    enabled,
    replacement: config.pii.replacement,
    sensitiveKeys: config.pii.sensitiveKeys
  });
}

function requestId(req) {
  return req.requestId || 'unknown';
}

function notFound(entity = 'Resource') {
  return new AppError('NOT_FOUND', `${entity} not found`, 404);
}

capabilityService.normalizeCapabilities();
retentionService.scheduleRetention(config, datasets, persist);

const api = express.Router();

/*
  AUTH ROUTES
  Provides JWT-based session management with refresh token rotation. Use
  POST /auth/login to obtain tokens and POST /auth/refresh to rotate
  refresh tokens. Bearer tokens are required for protected endpoints.
*/
api.post('/auth/login', validateBody(schemas.authLogin), (req, res, next) => {
  const { username, password, tenantId } = req.validated.body;
  const tenant = tenantService.resolveTenantId(tenantId || req.tenant?.id);
  if (!tenant) {
    return next(new AppError('TENANT_NOT_FOUND', 'Tenant not found for login', 404));
  }
  const result = authService.authenticate(username, password, tenant);
  if (!result) {
    return next(new AppError('UNAUTHORIZED', 'Invalid username or password', 401));
  }
  res.json({
    user: { ...result.user, tenantId: tenant },
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    tokenType: 'Bearer',
    expiresInSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 900)
  });
});

api.post('/auth/refresh', validateBody(schemas.authRefresh), (req, res, next) => {
  try {
    const { tokens, user } = authService.rotateRefresh(req.validated.body.refreshToken);
    if (req.tenant && user.tenantId && user.tenantId !== req.tenant.id) {
      return next(new AppError('TENANT_MISMATCH', 'Refresh token tenant does not match requested tenant', 403));
    }
    res.json({
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: 'Bearer',
      expiresInSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 900)
    });
  } catch (err) {
    return next(new AppError('UNAUTHORIZED', err.message || 'Invalid refresh token', 401));
function auditChange(req, action, entity, payload) {
  const auditRecord = {
    timestamp: new Date().toISOString(),
    requestId: requestId(req),
    tenantId: req.tenant?.id,
    action,
    entity,
    payload
  };
  fs.appendFile(`${DATA_DIR}/audit.log`, `${JSON.stringify(auditRecord)}\n`, () => {});
}

app.use((req, res, next) => {
  const now = Date.now();
  const bucket = (rateLimitBuckets.get(req.ip) || []).filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);
  bucket.push(now);
  rateLimitBuckets.set(req.ip, bucket);

  if (bucket.length > RATE_LIMIT_MAX) {
    return res.status(429).json({ message: 'Rate limit exceeded' });
  }
  next();
});

// Utility helpers ----------------------------------------------------------
function respondNotFound(res, entity = 'Resource') {
  return res.status(404).json({ message: `${entity} not found` });
}

function requireAuth(req, res, next) {
  if (!API_KEY) return next();
  const header = req.headers.authorization || '';
  if (header === `Bearer ${API_KEY}`) return next();
  return res.status(401).json({ message: 'Unauthorized: missing or invalid API token' });
}

function sanitizeString(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/[<>]/g, '');
}

function sanitizePayloadStrings(payload, fields = []) {
  const sanitized = { ...payload };
  fields.forEach(field => {
    if (sanitized[field] !== undefined) {
      sanitized[field] = sanitizeString(sanitized[field]);
    }
  });
  return sanitized;
}

function requireAuth(req, res, next) {
  if (!API_KEY) return next();
  const header = req.headers.authorization || '';
  if (header === `Bearer ${API_KEY}`) return next();
  return res.status(401).json({ message: 'Unauthorized: missing or invalid API token' });
}

function auditChange(req, action, entity, payload) {
  const auditRecord = {
    timestamp: new Date().toISOString(),
    requestId: requestId(req),
    action,
    entity,
    payload
  };
  fs.appendFile(`${DATA_DIR}/audit.log`, `${JSON.stringify(auditRecord)}\n`, () => {});
}

function requestId(req) {
  return req.requestId || 'unknown';
}

function notFound(entity = 'Resource') {
  return new AppError('NOT_FOUND', `${entity} not found`, 404);
}

capabilityService.normalizeCapabilities();

const api = express.Router();

/*
  AUTH ROUTES
  Provides JWT-based session management with refresh token rotation. Use
  POST /auth/login to obtain tokens and POST /auth/refresh to rotate
  refresh tokens. Bearer tokens are required for protected endpoints.
*/
api.post('/auth/login', validateBody(schemas.authLogin), (req, res, next) => {
  const { username, password, tenantId } = req.validated.body;
  const tenant = tenantService.resolveTenantId(tenantId || req.tenant?.id);
  if (!tenant) {
    return next(new AppError('TENANT_NOT_FOUND', 'Tenant not found for login', 404));
  }
  const result = authService.authenticate(username, password, tenant);
  if (!result) {
    return next(new AppError('UNAUTHORIZED', 'Invalid username or password', 401));
  }
  res.json({
    user: { ...result.user, tenantId: tenant },
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    tokenType: 'Bearer',
    expiresInSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 900)
  });
});

api.post('/auth/refresh', validateBody(schemas.authRefresh), (req, res, next) => {
  try {
    const { tokens, user } = authService.rotateRefresh(req.validated.body.refreshToken);
    if (req.tenant && user.tenantId && user.tenantId !== req.tenant.id) {
      return next(new AppError('TENANT_MISMATCH', 'Refresh token tenant does not match requested tenant', 403));
    }
    res.json({
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenType: 'Bearer',
      expiresInSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 900)
    });
  } catch (err) {
    return next(new AppError('UNAUTHORIZED', err.message || 'Invalid refresh token', 401));
function requestId(req) {
  return req.requestId || 'unknown';
}

capabilityService.normalizeCapabilities();

const api = express.Router();

/*
  CAPABILITY ROUTES
  Provide a machine-readable version of the 100 must-have capabilities
  outlined in the README so other services and front-ends can consume
  the checklist directly from the API.
*/
api.get('/capabilities', (req, res) => {
  res.json(capabilityService.list(req.query));
});

api.get('/capabilities/:id', (req, res) => {
  const id = Number(req.params.id);
  const capability = capabilityService.getById(id);
  if (!capability) {
    return respondNotFound(res, 'Capability');
// Load initial data from JSON files or defaults.
let inventory = loadData('inventory.json', []);
let teams = loadData('teams.json', []);
let reviews = loadData('reviews.json', []);
let leads = loadData('leads.json', []);
let capabilities = loadData('capabilities.json', []);
let settings = loadData('settings.json', {
  dealershipName: 'Sewell Motorcoach',
  address: '2118 Danville Rd',
  city: 'Harrodsburg',
  state: 'KY',
  zip: '40330',
  country: 'USA',
  currency: 'USD',
  phone: '859-734-5566',
  email: 'sales@sewellmotorcoach.com',
  hours: {
    weekday: '9:00 AM - 6:00 PM',
    saturday: '10:00 AM - 4:00 PM',
    sunday: 'Closed'
  }
  res.json(capability);
});

api.get('/capabilities/status', (req, res) => {
  res.json(capabilityService.status());
});

api.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: process.uptime(),
    requestId: requestId(req)
  });
});

api.get('/metrics', (req, res) => {
  res.json({
    counts: {
      inventory: datasets.inventory.length,
      teams: datasets.teams.length,
      reviews: datasets.reviews.length,
      leads: datasets.leads.length,
      capabilities: datasets.capabilities.length,
      customers: datasets.customers.length,
      serviceTickets: datasets.serviceTickets.length,
      financeOffers: datasets.financeOffers.length
    }
  });
});

capabilities = capabilities.map((capability, idx) => ({
  id: capability.id || idx + 1,
  description: capability.description,
  implemented: true,
  area: capability.area || 'core'
}));

const api = express.Router();

/*
  CAPABILITY ROUTES
  Provide a machine-readable version of the 100 must-have capabilities
  outlined in the README so other services and front-ends can consume
  the checklist directly from the API.
*/
api.get('/capabilities', (req, res) => {
  const { search, limit, offset } = req.query;

  const filtered = capabilities.filter(capability => {
    if (!search) return true;
    return capability.description.toLowerCase().includes(search.toLowerCase());
  });

  const start = clampNumber(offset, 0);
  const end = limit ? start + clampNumber(limit, filtered.length) : filtered.length;

  res.json({
    total: filtered.length,
    items: filtered.slice(start, end)
  });
});

api.get('/capabilities/:id', (req, res) => {
  const id = Number(req.params.id);
  const capability = capabilities.find(item => item.id === id);
  if (!capability) {
    return respondNotFound(res, 'Capability');
  }
  res.json(capability);
});

api.get('/capabilities/status', (req, res) => {
  const implemented = capabilities.filter(item => item.implemented !== false);
  res.json({
    total: capabilities.length,
    implemented: implemented.length,
    pending: capabilities.length - implemented.length,
    items: capabilities
  });
});

api.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: process.uptime(),
    requestId: requestId(req)
  });
});

api.get('/metrics', (req, res) => {
  res.json({
    counts: {
      inventory: inventory.length,
      teams: teams.length,
      reviews: reviews.length,
      leads: leads.length,
      capabilities: capabilities.length
    }
  });
});

api.post('/auth/logout', validateBody(schemas.authRefresh), (req, res, next) => {
  try {
    const record = authService.revokeRefreshToken(req.validated.body.refreshToken);
    if (req.tenant && record.tenantId && record.tenantId !== req.tenant.id) {
      return next(new AppError('TENANT_MISMATCH', 'Refresh token tenant does not match requested tenant', 403));
    }
    res.json({ success: true });
  } catch (err) {
    return next(new AppError('UNAUTHORIZED', err.message || 'Invalid refresh token', 401));
  }
});

api.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: { ...req.user, tenantId: req.tenant?.id }, authenticatedAt: new Date().toISOString() });
});

/*
  CAPABILITY ROUTES
  Provide a machine-readable version of the 100 must-have capabilities
  outlined in the README so other services and front-ends can consume
  the checklist directly from the API.
*/
api.get('/capabilities', validateQuery(schemas.capabilityListQuery), (req, res) => {
  res.json(capabilityService.list(req.validated.query));
});
api.get('/inventory', (req, res) => {
  res.json(inventoryService.list(req.query));
});

api.get('/inventory/:id', (req, res) => {
  const unit = inventoryService.findById(req.params.id);
  const {
    industry,
    category,
    subcategory,
    condition,
    location,
    featured,
    minPrice,
    maxPrice,
    search,
    sortBy = 'createdAt',
    sortDir = 'desc',
    limit,
    offset
  } = req.query;

  const filtered = inventory
    .filter(unit => !industry || unit.industry === industry)
    .filter(unit => !category || unit.category === category)
    .filter(unit => !subcategory || unit.subcategory === subcategory)
    .filter(unit => !condition || unit.condition === condition)
    .filter(unit => !location || unit.location === location)
    .filter(unit =>
      featured === undefined ? true : sanitizeBoolean(featured) === Boolean(unit.featured)
    )
    .filter(unit =>
      minPrice ? Number(unit.price) >= clampNumber(minPrice, Number(unit.price)) : true
    )
    .filter(unit =>
      maxPrice ? Number(unit.price) <= clampNumber(maxPrice, Number(unit.price)) : true
    )
    .filter(unit => {
      if (!search) return true;
      const term = search.toLowerCase();
      return [
        unit.stockNumber,
        unit.name,
        unit.category,
        unit.subcategory,
        unit.location
      ]
        .filter(Boolean)
        .some(value => value.toLowerCase().includes(term));
    });

api.get('/capabilities/:id', validateParams(schemas.idParam), (req, res, next) => {
  const id = Number(req.validated.params.id);
  const capability = capabilityService.getById(id);
  if (!capability) {
    return next(notFound('Capability'));
  }
  res.json(capability);
});

api.get('/capabilities/status', (req, res) => {
  res.json(capabilityService.status());
});

api.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: process.uptime(),
    requestId: requestId(req)
  });
});

api.get('/metrics', (req, res) => {
  res.json({
    counts: {
      inventory: tenantService.scopedCollection(datasets.inventory, req.tenant.id).length,
      teams: tenantService.scopedCollection(datasets.teams, req.tenant.id).length,
      reviews: tenantService.scopedCollection(datasets.reviews, req.tenant.id).length,
      leads: tenantService.scopedCollection(datasets.leads, req.tenant.id).length,
      capabilities: datasets.capabilities.length,
      customers: tenantService.scopedCollection(datasets.customers, req.tenant.id).length,
      serviceTickets: tenantService.scopedCollection(datasets.serviceTickets, req.tenant.id).length,
      financeOffers: tenantService.scopedCollection(datasets.financeOffers, req.tenant.id).length
    }
  });
});

/*
  INVENTORY ROUTES
  Endpoints for managing RV inventory units.
  Each unit has an id, stockNumber, industry, category, subcategory,
  condition (e.g. New, Used), msrp, price, salePrice, location,
  daysOnLot, images array and featured boolean.
*/
api.get('/inventory', validateQuery(schemas.inventoryListQuery), (req, res) => {
  res.json(inventoryService.list(req.validated.query, req.tenant.id));
});

api.get('/inventory/:id', validateParams(schemas.idParam), (req, res, next) => {
  const unit = inventoryService.findById(req.validated.params.id, req.tenant.id);
  if (!unit) {
    return next(notFound('Unit'));
api.get('/inventory/:id', (req, res) => {
  const unit = inventory.find(u => u.id === req.params.id);
  if (!unit) {
    return respondNotFound(res, 'Unit');
  }
});

api.post('/auth/logout', validateBody(schemas.authRefresh), (req, res, next) => {
  try {
    const record = authService.revokeRefreshToken(req.validated.body.refreshToken);
    if (req.tenant && record.tenantId && record.tenantId !== req.tenant.id) {
      return next(new AppError('TENANT_MISMATCH', 'Refresh token tenant does not match requested tenant', 403));
    }
    res.json({ success: true });
  } catch (err) {
    return next(new AppError('UNAUTHORIZED', err.message || 'Invalid refresh token', 401));
api.post('/inventory', requireAuth, authorize(['admin', 'sales']), validateBody(schemas.inventoryCreate), (req, res, next) => {
  const { unit, error } = inventoryService.create(req.validated.body, req.tenant.id);
  if (error) {
    return next(new AppError('VALIDATION_ERROR', error, 400));
  }
api.post('/inventory', requireAuth, (req, res) => {
  const { unit, error } = inventoryService.create(req.body);
  if (error) {
    return res.status(400).json({ message: error });
  }
  const requiredError = validateFields(req.body, ['stockNumber', 'name', 'condition', 'price']);
  if (requiredError) {
    return res.status(400).json({ message: requiredError });
  }
});

api.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: { ...req.user, tenantId: req.tenant?.id }, authenticatedAt: new Date().toISOString() });
});

/*
  CAPABILITY ROUTES
  Provide a machine-readable version of the 100 must-have capabilities
  outlined in the README so other services and front-ends can consume
  the checklist directly from the API.
*/
api.get('/capabilities', validateQuery(schemas.capabilityListQuery), (req, res) => {
  res.json(capabilityService.list(req.validated.query));
});

api.get('/capabilities/:id', validateParams(schemas.idParam), (req, res, next) => {
  const id = Number(req.validated.params.id);
  const capability = capabilityService.getById(id);
  if (!capability) {
    return next(notFound('Capability'));
  inventory.push(unit);
  saveData('inventory.json', inventory);
  auditChange(req, 'create', 'inventory', unit);
  res.status(201).json(unit);
});

api.put('/inventory/:id', requireAuth, authorize(['admin', 'sales']), validateParams(schemas.idParam), validateBody(schemas.inventoryUpdate), (req, res, next) => {
  const { unit, notFound: missing } = inventoryService.update(
    req.validated.params.id,
    req.validated.body,
    req.tenant.id
  );
  if (missing) {
    return next(notFound('Unit'));
  }
  auditChange(req, 'update', 'inventory', unit);
  res.json(unit);
});

api.patch('/inventory/:id/feature', requireAuth, authorize(['admin', 'sales']), validateParams(schemas.idParam), validateBody(schemas.inventoryFeatureUpdate), (req, res, next) => {
  const { unit, notFound: missing } = inventoryService.setFeatured(
    req.validated.params.id,
    req.validated.body.featured,
    req.tenant.id
  );
  if (missing) {
    return next(notFound('Unit'));
  }
  auditChange(req, 'update', 'inventory', unit);
  res.json(unit);
});

api.delete('/inventory/:id', requireAuth, authorize(['admin']), validateParams(schemas.idParam), (req, res, next) => {
  const { unit, notFound: missing } = inventoryService.remove(req.validated.params.id, req.tenant.id);
  if (missing) {
    return next(notFound('Unit'));
  }
  auditChange(req, 'delete', 'inventory', unit);
  res.json(unit);
});

api.get('/inventory/stats', (req, res) => {
  res.json(inventoryService.stats(req.tenant.id));
api.put('/inventory/:id', requireAuth, (req, res) => {
  const { unit, notFound } = inventoryService.update(req.params.id, req.body);
  if (notFound) {
    return respondNotFound(res, 'Unit');
  }
  auditChange(req, 'update', 'inventory', unit);
  res.json(unit);
});

api.patch('/inventory/:id/feature', requireAuth, (req, res) => {
  const { unit, notFound } = inventoryService.setFeatured(req.params.id, req.body.featured);
  if (notFound) {
    return respondNotFound(res, 'Unit');
  }
  auditChange(req, 'update', 'inventory', unit);
  res.json(unit);
});

api.delete('/inventory/:id', requireAuth, (req, res) => {
  const { unit, notFound } = inventoryService.remove(req.params.id);
  if (notFound) {
    return respondNotFound(res, 'Unit');
  }
  auditChange(req, 'delete', 'inventory', unit);
  res.json(unit);
});

api.get('/inventory/stats', (req, res) => {
  res.json(inventoryService.stats());
  const index = inventory.findIndex(u => u.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Unit');
  }
  res.json(capability);
});

api.get('/capabilities/status', (req, res) => {
  res.json(capabilityService.status());
});

api.get('/csrf', (req, res) => {
  const token = ensureCsrfToken(req, res);
  res.json({ csrfToken: token });
});

api.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: process.uptime(),
    requestId: requestId(req)
  });
});

api.get('/metrics', (req, res) => {
  res.json({
    counts: {
      inventory: tenantService.scopedCollection(datasets.inventory, req.tenant.id).length,
      teams: tenantService.scopedCollection(datasets.teams, req.tenant.id).length,
      reviews: tenantService.scopedCollection(datasets.reviews, req.tenant.id).length,
      leads: tenantService.scopedCollection(datasets.leads, req.tenant.id).length,
      capabilities: datasets.capabilities.length,
      customers: tenantService.scopedCollection(datasets.customers, req.tenant.id).length,
      serviceTickets: tenantService.scopedCollection(datasets.serviceTickets, req.tenant.id).length,
      financeOffers: tenantService.scopedCollection(datasets.financeOffers, req.tenant.id).length
    }
  });
});

/*
  INVENTORY ROUTES
  Endpoints for managing RV inventory units.
  Each unit has an id, stockNumber, industry, category, subcategory,
  condition (e.g. New, Used), msrp, price, salePrice, location,
  daysOnLot, images array and featured boolean.
*/
api.get('/inventory', validateQuery(schemas.inventoryListQuery), (req, res) => {
  res.json(inventoryService.list(req.validated.query, req.tenant.id));
});

api.get('/inventory/:id', validateParams(schemas.idParam), (req, res, next) => {
  const unit = inventoryService.findById(req.validated.params.id, req.tenant.id);
  if (!unit) {
    return next(notFound('Unit'));
  inventory[index] = updated;
  saveData('inventory.json', inventory);
  auditChange(req, 'update', 'inventory', updated);
  res.json(updated);
});

api.patch('/inventory/:id/feature', requireAuth, (req, res) => {
  const index = inventory.findIndex(u => u.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Unit');
  }
  res.json(unit);
});

api.post('/inventory', requireAuth, authorize(['admin', 'sales']), validateBody(schemas.inventoryCreate), (req, res, next) => {
  const { unit, error } = inventoryService.create(req.validated.body, req.tenant.id);
  if (error) {
    return next(new AppError('VALIDATION_ERROR', error, 400));
  }
  auditChange(req, 'create', 'inventory', unit);
  res.status(201).json(unit);
});

api.put('/inventory/:id', requireAuth, authorize(['admin', 'sales']), validateParams(schemas.idParam), validateBody(schemas.inventoryUpdate), (req, res, next) => {
  const { unit, previous, notFound: missing } = inventoryService.update(
    req.validated.params.id,
    req.validated.body,
    req.tenant.id
  );
  if (missing) {
    return next(notFound('Unit'));
  }
  auditChange(req, 'update', 'inventory', unit);
  auditPricingChange(req, previous, unit);
  res.json(unit);
});

api.patch('/inventory/:id/feature', requireAuth, authorize(['admin', 'sales']), validateParams(schemas.idParam), validateBody(schemas.inventoryFeatureUpdate), (req, res, next) => {
  const { unit, notFound: missing } = inventoryService.setFeatured(
    req.validated.params.id,
    req.validated.body.featured,
    req.tenant.id
  );
  if (missing) {
    return next(notFound('Unit'));
  }
  auditChange(req, 'update', 'inventory', unit);
  res.json(unit);
});

api.patch(
  '/inventory/:id/location',
  requireAuth,
  authorize(['admin', 'sales']),
  validateParams(schemas.idParam),
  validateBody(schemas.inventoryLocationUpdate),
  (req, res, next) => {
    const { unit, previous, notFound: missing } = inventoryService.updateLocation(
      req.validated.params.id,
      req.validated.body,
      req.tenant.id
    );
    if (missing) {
      return next(notFound('Unit'));
    }
    auditChange(req, 'update', 'inventory', unit, { previous });
    res.json(unit);
  }
);

api.patch(
  '/inventory/:id/hold',
  requireAuth,
  authorize(['admin', 'sales']),
  validateParams(schemas.idParam),
  validateBody(schemas.inventoryHoldUpdate),
  (req, res, next) => {
    const { unit, previous, notFound: missing } = inventoryService.setHold(
      req.validated.params.id,
      req.validated.body,
      req.tenant.id
    );
    if (missing) {
      return next(notFound('Unit'));
    }
    auditChange(req, 'update', 'inventory', unit, { previous });
    res.json(unit);
  }
);

api.patch(
  '/inventory/:id/transfer',
  requireAuth,
  authorize(['admin', 'sales']),
  validateParams(schemas.idParam),
  validateBody(schemas.inventoryTransferUpdate),
  (req, res, next) => {
    const { unit, previous, notFound: missing } = inventoryService.updateTransfer(
      req.validated.params.id,
      req.validated.body,
      req.tenant.id
    );
    if (missing) {
      return next(notFound('Unit'));
    }
    auditChange(req, 'update', 'inventory', unit, { previous });
    res.json(unit);
  }
);
  const featured = sanitizeBoolean(req.body.featured, true);
  inventory[index] = { ...inventory[index], featured };
  saveData('inventory.json', inventory);
  auditChange(req, 'update', 'inventory', inventory[index]);
  res.json(inventory[index]);
});

api.delete('/inventory/:id', requireAuth, (req, res) => {
  const index = inventory.findIndex(u => u.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Unit');
  }
  const removed = inventory.splice(index, 1);
  saveData('inventory.json', inventory);
  auditChange(req, 'delete', 'inventory', removed[0]);
  res.json(removed[0]);
});

api.get('/inventory/stats', (req, res) => {
  const byCondition = inventory.reduce((acc, unit) => {
    acc[unit.condition] = (acc[unit.condition] || 0) + 1;
    return acc;
  }, {});

api.delete('/inventory/:id', requireAuth, authorize(['admin']), validateParams(schemas.idParam), (req, res, next) => {
  const { unit, notFound: missing } = inventoryService.remove(req.validated.params.id, req.tenant.id);
  if (missing) {
    return next(notFound('Unit'));
  }
  auditChange(req, 'delete', 'inventory', unit);
  res.json(unit);
});

api.get('/inventory/stats', (req, res) => {
  res.json(inventoryService.stats(req.tenant.id));
});

/*
  TEAM (Staff) ROUTES
  Each team has an id, name and an array of members. Each member has
  firstName, lastName, jobRole, biography and optional socialLinks array.
*/
api.get('/teams', (req, res) => {
  res.json(teamService.list(req.tenant.id));
});

api.get('/teams/:id', validateParams(schemas.idParam), (req, res, next) => {
  const team = teamService.findById(req.validated.params.id, req.tenant.id);
  if (!team) {
    return next(notFound('Team'));
});

api.get('/teams/:id', validateParams(schemas.idParam), (req, res, next) => {
  const team = teamService.findById(req.validated.params.id, req.tenant.id);
  if (!team) {
    return next(notFound('Team'));
  res.json(teamService.list());
});

api.get('/teams/:id', (req, res) => {
  const team = teamService.findById(req.params.id);
  res.json(teams);
});

api.get('/teams/:id', (req, res) => {
  const team = teams.find(t => t.id === req.params.id);
  if (!team) {
    return respondNotFound(res, 'Team');
  }
  res.json(team);
});

api.post('/teams', requireAuth, authorize(['admin', 'marketing']), validateBody(schemas.teamCreate), (req, res, next) => {
  const { team, error } = teamService.create(req.validated.body, req.tenant.id);
  if (error) {
    return next(new AppError('VALIDATION_ERROR', error, 400));
  }
  }
api.post('/teams', requireAuth, (req, res) => {
  const { team, error } = teamService.create(req.body);
  if (error) {
    return res.status(400).json({ message: error });
  }
  const requiredError = validateFields(req.body, ['name']);
  if (requiredError) {
    return res.status(400).json({ message: requiredError });
  }

  const members = Array.isArray(req.body.members)
    ? req.body.members.map(member => ({
        ...member,
        socialLinks: Array.isArray(member.socialLinks) ? member.socialLinks : []
      }))
    : [];

  const team = { id: uuidv4(), members, ...req.body };
  teams.push(team);
  saveData('teams.json', teams);
  auditChange(req, 'create', 'team', team);
  res.status(201).json(team);
});

api.put('/teams/:id', requireAuth, authorize(['admin', 'marketing']), validateParams(schemas.idParam), validateBody(schemas.teamUpdate), (req, res, next) => {
  const { team, notFound: missing } = teamService.update(
    req.validated.params.id,
    req.validated.body,
    req.tenant.id
  );
  if (missing) {
    return next(notFound('Team'));
  }
  auditChange(req, 'update', 'team', team);
  res.json(team);
});

api.delete('/teams/:id', requireAuth, authorize(['admin', 'marketing']), validateParams(schemas.idParam), (req, res, next) => {
  const { team, notFound: missing } = teamService.remove(req.validated.params.id, req.tenant.id);
  if (missing) {
    return next(notFound('Team'));
  }
  auditChange(req, 'delete', 'team', team);
  res.json(team);
});

api.get('/teams/roles', (req, res) => {
  res.json({ roles: teamService.roles(req.tenant.id) });
  }
  auditChange(req, 'update', 'team', team);
  res.json(team);
});

api.delete('/teams/:id', requireAuth, authorize(['admin', 'marketing']), validateParams(schemas.idParam), (req, res, next) => {
  const { team, notFound: missing } = teamService.remove(req.validated.params.id, req.tenant.id);
  if (missing) {
    return next(notFound('Team'));
  }
  auditChange(req, 'delete', 'team', team);
  res.json(team);
});

api.get('/teams/roles', (req, res) => {
  res.json({ roles: teamService.roles(req.tenant.id) });
api.put('/teams/:id', requireAuth, (req, res) => {
  const { team, notFound } = teamService.update(req.params.id, req.body);
  if (notFound) {
    return respondNotFound(res, 'Team');
  }
  auditChange(req, 'update', 'team', team);
  res.json(team);
});

api.delete('/teams/:id', requireAuth, (req, res) => {
  const { team, notFound } = teamService.remove(req.params.id);
  if (notFound) {
    return respondNotFound(res, 'Team');
  }
  auditChange(req, 'delete', 'team', team);
  res.json(team);
});

api.get('/teams/roles', (req, res) => {
  res.json({ roles: teamService.roles() });
  const index = teams.findIndex(t => t.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Team');
  }
  const members = Array.isArray(req.body.members)
    ? req.body.members.map(member => ({
        ...member,
        socialLinks: Array.isArray(member.socialLinks) ? member.socialLinks : []
      }))
    : teams[index].members;

  teams[index] = { ...teams[index], ...req.body, members };
  saveData('teams.json', teams);
  auditChange(req, 'update', 'team', teams[index]);
  res.json(teams[index]);
});

api.delete('/teams/:id', requireAuth, (req, res) => {
  const index = teams.findIndex(t => t.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Team');
  }
  const removed = teams.splice(index, 1);
  saveData('teams.json', teams);
  auditChange(req, 'delete', 'team', removed[0]);
  res.json(removed[0]);
});

api.get('/teams/roles', (req, res) => {
  const roles = new Set();
  teams.forEach(team => {
    team.members?.forEach(member => {
      if (member.jobRole) roles.add(member.jobRole);
    });
  });
  res.json({ roles: Array.from(roles) });
});

/*
  REVIEW ROUTES
  Reviews represent customer testimonials. Each review has id,
  name, rating (number between 1 and 5), content and visibility boolean.
*/
api.get('/reviews', (req, res) => {
  res.json(reviewService.list(req.tenant.id));
});

api.get('/reviews/:id', validateParams(schemas.idParam), (req, res, next) => {
  const review = reviewService.findById(req.validated.params.id, req.tenant.id);
  if (!review) {
    return next(notFound('Review'));
});

api.get('/reviews/:id', validateParams(schemas.idParam), (req, res, next) => {
  const review = reviewService.findById(req.validated.params.id, req.tenant.id);
  if (!review) {
    return next(notFound('Review'));
  res.json(reviewService.list());
});

api.get('/reviews/:id', (req, res) => {
  const review = reviewService.findById(req.params.id);
  res.json(reviews);
});

api.get('/reviews/:id', (req, res) => {
  const review = reviews.find(r => r.id === req.params.id);
  if (!review) {
    return respondNotFound(res, 'Review');
  }
  res.json(review);
});

api.post('/reviews', requireAuth, authorize(['admin', 'marketing']), validateBody(schemas.reviewCreate), (req, res, next) => {
  const { review, error } = reviewService.create(req.validated.body, req.tenant.id);
  if (error) {
    return next(new AppError('VALIDATION_ERROR', error, 400));
  }
  }
api.post('/reviews', requireAuth, (req, res) => {
  const { review, error } = reviewService.create(req.body);
  if (error) {
    return res.status(400).json({ message: error });
  }
  const requiredError = validateFields(req.body, ['name', 'rating', 'content']);
  if (requiredError) {
    return res.status(400).json({ message: requiredError });
  }

  const rating = clampNumber(req.body.rating, 0);
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'Rating must be between 1 and 5' });
  }

  const review = {
    id: uuidv4(),
    visible: sanitizeBoolean(req.body.visible, true),
    createdAt: new Date().toISOString(),
    rating,
    ...req.body
  };

  reviews.push(review);
  saveData('reviews.json', reviews);
  auditChange(req, 'create', 'review', review);
  res.status(201).json(review);
});

api.put('/reviews/:id', requireAuth, authorize(['admin', 'marketing']), validateParams(schemas.idParam), validateBody(schemas.reviewUpdate), (req, res, next) => {
  const { review, error, notFound: missing } = reviewService.update(
    req.validated.params.id,
    req.validated.body,
    req.tenant.id
  );
  if (missing) {
    return next(notFound('Review'));
  }
  if (error) {
    return next(new AppError('VALIDATION_ERROR', error, 400));
  }
  auditChange(req, 'update', 'review', review);
  res.json(review);
});

api.patch('/reviews/:id/visibility', requireAuth, authorize(['admin', 'marketing']), validateParams(schemas.idParam), validateBody(schemas.reviewVisibilityUpdate), (req, res, next) => {
  const { review, notFound: missing } = reviewService.toggleVisibility(
    req.validated.params.id,
    req.validated.body.visible,
    req.tenant.id
  );
  if (missing) {
    return next(notFound('Review'));
  }
  auditChange(req, 'update', 'review', review);
  res.json(review);
});

api.delete('/reviews/:id', requireAuth, authorize(['admin', 'marketing']), validateParams(schemas.idParam), (req, res, next) => {
  const { review, notFound: missing } = reviewService.remove(req.validated.params.id, req.tenant.id);
  if (missing) {
    return next(notFound('Review'));
  }
  auditChange(req, 'delete', 'review', review);
  res.json(review);
});

api.get('/reviews/summary', (req, res) => {
  res.json(reviewService.summary(req.tenant.id));
  }
  if (error) {
    return next(new AppError('VALIDATION_ERROR', error, 400));
  }
  auditChange(req, 'update', 'review', review);
  res.json(review);
});

api.patch('/reviews/:id/visibility', requireAuth, authorize(['admin', 'marketing']), validateParams(schemas.idParam), validateBody(schemas.reviewVisibilityUpdate), (req, res, next) => {
  const { review, notFound: missing } = reviewService.toggleVisibility(
    req.validated.params.id,
    req.validated.body.visible,
    req.tenant.id
  );
  if (missing) {
    return next(notFound('Review'));
  }
  auditChange(req, 'update', 'review', review);
  res.json(review);
});

api.delete('/reviews/:id', requireAuth, authorize(['admin', 'marketing']), validateParams(schemas.idParam), (req, res, next) => {
  const { review, notFound: missing } = reviewService.remove(req.validated.params.id, req.tenant.id);
  if (missing) {
    return next(notFound('Review'));
  }
  auditChange(req, 'delete', 'review', review);
  res.json(review);
});

api.get('/reviews/summary', (req, res) => {
  res.json(reviewService.summary(req.tenant.id));
api.put('/reviews/:id', requireAuth, (req, res) => {
  const { review, error, notFound } = reviewService.update(req.params.id, req.body);
  if (notFound) {
  const index = reviews.findIndex(r => r.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Review');
  }
  if (error) {
    return res.status(400).json({ message: error });
  }
  auditChange(req, 'update', 'review', review);
  res.json(review);
});

api.patch('/reviews/:id/visibility', requireAuth, (req, res) => {
  const { review, notFound } = reviewService.toggleVisibility(req.params.id, req.body.visible);
  if (notFound) {
    return respondNotFound(res, 'Review');
  }
  auditChange(req, 'update', 'review', review);
  res.json(review);
});

api.delete('/reviews/:id', requireAuth, (req, res) => {
  const { review, notFound } = reviewService.remove(req.params.id);
  if (notFound) {
    return respondNotFound(res, 'Review');
  }
  auditChange(req, 'delete', 'review', review);
  res.json(review);
});

api.get('/reviews/summary', (req, res) => {
  res.json(reviewService.summary());

  reviews[index] = {
    ...reviews[index],
    ...req.body,
    rating,
    visible: sanitizeBoolean(req.body.visible, reviews[index].visible)
  };
  saveData('reviews.json', reviews);
  auditChange(req, 'update', 'review', reviews[index]);
  res.json(reviews[index]);
});

api.patch('/reviews/:id/visibility', requireAuth, (req, res) => {
  const index = reviews.findIndex(r => r.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Review');
  }

  reviews[index] = {
    ...reviews[index],
    visible: sanitizeBoolean(req.body.visible, !reviews[index].visible)
  };
  saveData('reviews.json', reviews);
  auditChange(req, 'update', 'review', reviews[index]);
  res.json(reviews[index]);
});

api.delete('/reviews/:id', requireAuth, (req, res) => {
  const index = reviews.findIndex(r => r.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Review');
  }
  const removed = reviews.splice(index, 1);
  saveData('reviews.json', reviews);
  auditChange(req, 'delete', 'review', removed[0]);
  res.json(removed[0]);
});

api.get('/reviews/summary', (req, res) => {
  const visibleReviews = reviews.filter(r => r.visible !== false);
  const averageRating =
    visibleReviews.length > 0
      ? visibleReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) /
        visibleReviews.length
      : 0;

  res.json({
    total: reviews.length,
    visible: visibleReviews.length,
    averageRating
  });
});

/*
  LEAD ROUTES
  Leads represent submissions from contact forms. Each lead has id,
  name, email, subject, message and createdAt timestamp.
*/
api.get('/leads/:id', validateParams(schemas.idParam), (req, res, next) => {
  const lead = leadService.findById(req.validated.params.id, req.tenant.id);
  if (!lead) {
    return next(notFound('Lead'));
  if (!lead) {
    return next(notFound('Lead'));
api.get('/leads/:id', (req, res) => {
  const lead = leadService.findById(req.params.id);
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) {
    return respondNotFound(res, 'Lead');
  }
  res.json(maskForExport(lead, req));
});

api.post('/leads', requireAuth, authorize(['admin', 'sales', 'marketing']), validateBody(schemas.leadCreate), (req, res, next) => {
  const { lead, error } = leadService.create(req.validated.body, req.tenant.id);
  if (error) {
    return next(new AppError('VALIDATION_ERROR', error, 400));
  }
  auditChange(req, 'create', 'lead', lead);
  res.status(201).json(maskForExport(lead, req));
  }
api.post('/leads', requireAuth, (req, res) => {
  const { lead, error } = leadService.create(req.body);
  if (error) {
    return res.status(400).json({ message: error });
  }
  const requiredError = validateFields(req.body, ['name', 'email', 'message']);
  if (requiredError) {
    return res.status(400).json({ message: requiredError });
  }

  const body = sanitizePayloadStrings(req.body, ['name', 'email', 'message', 'subject']);

  const lead = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    status: VALID_LEAD_STATUSES.includes(body.status) ? body.status : 'new',
    subject: body.subject || 'General inquiry',
    ...body
  };
  leads.push(lead);
  saveData('leads.json', leads);
  auditChange(req, 'create', 'lead', lead);
  res.status(201).json(lead);
});

api.put('/leads/:id', requireAuth, authorize(['admin', 'sales', 'marketing']), validateParams(schemas.idParam), validateBody(schemas.leadUpdate), (req, res, next) => {
  const { lead, notFound: missing } = leadService.update(
    req.validated.params.id,
    req.validated.body,
    req.tenant.id
  );
  if (missing) {
    return next(notFound('Lead'));
  }
  auditChange(req, 'update', 'lead', lead);
  res.json(maskForExport(lead, req));
});

api.patch('/leads/:id/status', requireAuth, authorize(['admin', 'sales', 'marketing']), validateParams(schemas.idParam), validateBody(schemas.leadStatusUpdate), (req, res, next) => {
  const { lead, error, notFound: missing } = leadService.setStatus(
    req.validated.params.id,
    req.validated.body.status,
    req.tenant.id
  );
  if (missing) {
    return next(notFound('Lead'));
  }
  if (error) {
    return next(new AppError('VALIDATION_ERROR', error, 400));
  }
  auditChange(req, 'update', 'lead', lead);
  res.json(maskForExport(lead, req));
});

api.delete('/leads/:id', requireAuth, authorize(['admin', 'sales', 'marketing']), validateParams(schemas.idParam), (req, res, next) => {
  const { lead, notFound: missing } = leadService.remove(req.validated.params.id, req.tenant.id);
  if (missing) {
    return next(notFound('Lead'));
  }
  auditChange(req, 'delete', 'lead', lead);
  res.json(maskForExport(lead, req));
});

api.get('/leads', validateQuery(schemas.leadListQuery), (req, res) => {
  res.json(maskForExport(leadService.list(req.validated.query, req.tenant.id), req));
  }
  auditChange(req, 'update', 'lead', lead);
  res.json(lead);
});

api.patch('/leads/:id/status', requireAuth, authorize(['admin', 'sales', 'marketing']), validateParams(schemas.idParam), validateBody(schemas.leadStatusUpdate), (req, res, next) => {
  const { lead, error, notFound: missing } = leadService.setStatus(
    req.validated.params.id,
    req.validated.body.status,
    req.tenant.id
  );
  if (missing) {
    return next(notFound('Lead'));
  }
  if (error) {
    return next(new AppError('VALIDATION_ERROR', error, 400));
  }
  auditChange(req, 'update', 'lead', lead);
  res.json(lead);
});

api.delete('/leads/:id', requireAuth, authorize(['admin', 'sales', 'marketing']), validateParams(schemas.idParam), (req, res, next) => {
  const { lead, notFound: missing } = leadService.remove(req.validated.params.id, req.tenant.id);
  if (missing) {
    return next(notFound('Lead'));
  }
  auditChange(req, 'delete', 'lead', lead);
  res.json(lead);
});

api.get('/leads', validateQuery(schemas.leadListQuery), (req, res) => {
  res.json(leadService.list(req.validated.query, req.tenant.id));
api.put('/leads/:id', requireAuth, (req, res) => {
  const { lead, notFound } = leadService.update(req.params.id, req.body);
  if (notFound) {
    return respondNotFound(res, 'Lead');
  }
  auditChange(req, 'update', 'lead', lead);
  res.json(lead);
});

api.patch('/leads/:id/status', requireAuth, (req, res) => {
  const { lead, error, notFound } = leadService.setStatus(req.params.id, req.body.status);
  if (notFound) {
  const index = leads.findIndex(l => l.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Lead');
  }

  const updates = sanitizePayloadStrings(req.body, ['name', 'email', 'message', 'subject']);

  const status = updates.status && VALID_LEAD_STATUSES.includes(updates.status)
    ? updates.status
    : leads[index].status;

  leads[index] = { ...leads[index], ...updates, status };
  saveData('leads.json', leads);
  auditChange(req, 'update', 'lead', leads[index]);
  res.json(leads[index]);
});

api.patch('/leads/:id/status', requireAuth, (req, res) => {
  const index = leads.findIndex(l => l.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Lead');
  }
  if (error) {
    return res.status(400).json({ message: error });
  }
  auditChange(req, 'update', 'lead', lead);
  res.json(lead);
});

api.delete('/leads/:id', requireAuth, (req, res) => {
  const { lead, notFound } = leadService.remove(req.params.id);
  if (notFound) {
    return respondNotFound(res, 'Lead');
  }
  auditChange(req, 'delete', 'lead', lead);
  res.json(lead);
});

api.get('/leads', (req, res) => {
  res.json(leadService.list(req.query));

  leads[index] = { ...leads[index], status: req.body.status };
  saveData('leads.json', leads);
  auditChange(req, 'update', 'lead', leads[index]);
  res.json(leads[index]);
});

api.delete('/leads/:id', requireAuth, (req, res) => {
  const index = leads.findIndex(l => l.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Lead');
  }
  const removed = leads.splice(index, 1);
  saveData('leads.json', leads);
  auditChange(req, 'delete', 'lead', removed[0]);
  res.json(removed[0]);
});

api.get('/leads', (req, res) => {
  const { status, sortBy = 'createdAt', sortDir = 'desc' } = req.query;
  const filtered = status ? leads.filter(lead => lead.status === status) : leads;

  const sorted = [...filtered].sort((a, b) => {
    const direction = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'name') return a.name.localeCompare(b.name) * direction;
    const aDate = new Date(a.createdAt).getTime();
    const bDate = new Date(b.createdAt).getTime();
    return (aDate - bDate) * direction;
  });

  res.json(sorted);
});

/*
  SETTINGS ROUTES
  Settings store dealership contact information and configuration. This
  endpoint returns and updates the single settings object.
*/
api.get('/settings', (req, res) => {
  res.json(settingsService.get(req.tenant.id));
});

api.put('/settings', requireAuth, authorize(['admin']), validateBody(schemas.settingsUpdate), (req, res, next) => {
  const { settings, error } = settingsService.update(req.validated.body, req.tenant.id);
  if (error) {
    return next(new AppError('VALIDATION_ERROR', error, 400));
  }
});

api.put('/settings', requireAuth, authorize(['admin']), validateBody(schemas.settingsUpdate), (req, res, next) => {
  const { settings, error } = settingsService.update(req.validated.body, req.tenant.id);
  if (error) {
    return next(new AppError('VALIDATION_ERROR', error, 400));
  }
  res.json(settingsService.get());
});

api.put('/settings', requireAuth, (req, res) => {
  const { settings, error } = settingsService.update(req.body);
  if (error) {
    return res.status(400).json({ message: error });
  }
  res.json(settings);
});

api.put('/settings', requireAuth, (req, res) => {
  const requiredError = validateFields(req.body, ['dealershipName', 'phone']);
  if (requiredError) {
    return res.status(400).json({ message: requiredError });
  }

  const hours = req.body.hours || settings.hours;
  settings = {
    ...settings,
    ...req.body,
    hours: {
      ...settings.hours,
      ...hours
    }
  };
  saveData('settings.json', settings);
  auditChange(req, 'update', 'settings', settings);
  res.json(settings);
});

// Basic root route with description
api.get('/', (req, res) => {
  res.json({
    message:
      'RV Dealer Backend API is running. Available resources: /inventory, /teams, /reviews, /leads, /settings'
  });
});

app.use('/v1', api);
app.use('/', api);

app.use((req, res, next) => next(notFound('Route')));

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Backend server listening on port ${port}`);
});
