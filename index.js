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
const { datasets } = require('./src/services/state');
const tenantService = require('./src/services/tenantService');
const { validateBody, validateParams, validateQuery } = require('./src/middleware/validation');
const { schemas } = require('./src/validation/schemas');
const { AppError, errorHandler } = require('./src/middleware/errors');
const { sanitizeString } = require('./src/services/shared');

tenantService.initializeTenants();

const app = express();
app.set('trust proxy', 1);
const port = config.server.port;
const API_KEY = config.auth.apiKey;
const RATE_LIMIT_WINDOW_MS = config.rateLimit.windowMs;
const RATE_LIMIT_MAX = config.rateLimit.max;
const COOKIE_SECURE = config.env === 'production' || config.server.enforceHttps;
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SECURE ? 'none' : 'lax',
  path: '/v1/auth/refresh',
  maxAge: config.auth.refreshTokenTtlSeconds * 1000
};

const rateLimitBuckets = new Map();

function parseCookies(req, _res, next) {
  req.cookies = {};
  const header = req.headers.cookie;
  if (!header) return next();
  header.split(';').forEach(part => {
    const [name, ...rest] = part.split('=');
    if (!name) return;
    try {
      req.cookies[name.trim()] = decodeURIComponent(rest.join('=') || '');
    } catch (err) {
      req.cookies[name.trim()] = rest.join('=');
    }
  });
  next();
}

app.use(bodyParser.json());
app.use(parseCookies);
app.use(cors({ origin: true, credentials: true }));

// Input sanitization
app.use((req, res, next) => {
  const clean = value => {
    if (typeof value === 'string') return sanitizeString(value);
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]));
    }
    return value;
  };
  if (req.body) req.body = clean(req.body);
  if (req.query) req.query = clean(req.query);
  if (req.params) req.params = clean(req.params);
  next();
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
  });
  next();
});

app.use((req, res, next) => {
  if (config.server.enforceHttps && req.headers['x-forwarded-proto'] === 'http') {
    return next(new AppError('HTTPS_REQUIRED', 'HTTPS is required', 400));
  }
  if (config.server.enforceHttps || req.headers['x-forwarded-proto'] === 'https') {
    res.set('Strict-Transport-Security', `max-age=${config.server.hstsMaxAgeSeconds}; includeSubDomains`);
  }
  next();
});

app.use((req, res, next) => {
  const now = Date.now();
  const bucket = (rateLimitBuckets.get(req.ip) || []).filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);
  bucket.push(now);
  rateLimitBuckets.set(req.ip, bucket);

  if (bucket.length > RATE_LIMIT_MAX) {
    return next(new AppError('RATE_LIMIT_EXCEEDED', 'Rate limit exceeded', 429));
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
  }
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

function auditChange(req, action, entity, payload) {
  const auditRecord = {
    timestamp: new Date().toISOString(),
    requestId: req.requestId || 'unknown',
    tenantId: req.tenant?.id,
    action,
    entity,
    payload
  };
  fs.appendFile(`${DATA_DIR}/audit.log`, `${JSON.stringify(auditRecord)}\n`, () => {});
}

// Routes -------------------------------------------------------------------
const api = express.Router();

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
  res.cookie('refreshToken', result.tokens.refreshToken, REFRESH_COOKIE_OPTIONS);
  res.json({
    user: { ...result.user, tenantId: tenant },
    accessToken: result.tokens.accessToken,
    tokenType: 'Bearer',
    expiresInSeconds: config.auth.accessTokenTtlSeconds
  });
});

api.post('/auth/refresh', validateBody(schemas.authRefresh), (req, res, next) => {
  try {
    const token = req.validated.body.refreshToken || req.cookies?.refreshToken;
    if (!token) {
      return next(new AppError('UNAUTHORIZED', 'Refresh token missing', 401));
    }
    const { tokens, user } = authService.rotateRefresh(token);
    if (req.tenant && user.tenantId && user.tenantId !== req.tenant.id) {
      return next(new AppError('TENANT_MISMATCH', 'Refresh token tenant does not match requested tenant', 403));
    }
    res.cookie('refreshToken', tokens.refreshToken, REFRESH_COOKIE_OPTIONS);
    res.json({
      user,
      accessToken: tokens.accessToken,
      tokenType: 'Bearer',
      expiresInSeconds: config.auth.accessTokenTtlSeconds
    });
  } catch (err) {
    return next(new AppError('UNAUTHORIZED', err.message || 'Invalid refresh token', 401));
  }
});

api.get('/capabilities', (req, res) => {
  res.json(capabilityService.list(req.query));
});

api.get('/capabilities/:id', (req, res, next) => {
  const id = Number(req.params.id);
  const capability = capabilityService.getById(id);
  if (!capability) {
    return next(new AppError('NOT_FOUND', 'Capability not found', 404));
  }
  res.json(capability);
});

api.get('/capabilities/status', (req, res) => {
  res.json(capabilityService.status());
});

api.get('/inventory', (req, res) => {
  res.json(inventoryService.list(req.query, req.tenant.id));
});

api.get('/inventory/:id', validateParams(schemas.inventoryId), (req, res, next) => {
  const unit = inventoryService.findById(req.validated.params.id, req.tenant.id);
  if (!unit) return next(new AppError('NOT_FOUND', 'Inventory not found', 404));
  res.json(unit);
});

api.post('/inventory', requireAuth, authorize(['admin', 'sales']), validateBody(schemas.inventoryCreate), (req, res, next) => {
  const result = inventoryService.create(req.validated.body, req.tenant.id);
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  auditChange(req, 'create', 'inventory', result.unit);
  res.status(201).json(result.unit);
});

api.put('/inventory/:id', requireAuth, authorize(['admin', 'sales']), validateBody(schemas.inventoryUpdate), (req, res, next) => {
  const result = inventoryService.update(req.params.id, req.validated.body, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Inventory not found', 404));
  auditChange(req, 'update', 'inventory', result.unit);
  res.json(result.unit);
});

api.patch('/inventory/:id/feature', requireAuth, authorize(['admin', 'sales']), (req, res, next) => {
  const result = inventoryService.setFeatured(req.params.id, req.body.featured, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Inventory not found', 404));
  auditChange(req, 'feature', 'inventory', result.unit);
  res.json(result.unit);
});

api.delete('/inventory/:id', requireAuth, authorize(['admin']), (req, res, next) => {
  const result = inventoryService.remove(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Inventory not found', 404));
  auditChange(req, 'delete', 'inventory', result.unit);
  res.status(204).send();
});

api.get('/leads', requireAuth, authorize(['admin', 'sales', 'marketing']), (req, res) => {
  res.json(leadService.list(req.query, req.tenant.id));
});

api.get('/leads/:id', requireAuth, authorize(['admin', 'sales', 'marketing']), (req, res, next) => {
  const lead = leadService.findById(req.params.id, req.tenant.id);
  if (!lead) return next(new AppError('NOT_FOUND', 'Lead not found', 404));
  res.json(lead);
});

api.post('/leads', validateBody(schemas.leadCreate), (req, res, next) => {
  const result = leadService.create(req.validated.body, req.tenant.id);
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  res.status(201).json(result.lead);
});

api.put('/leads/:id', requireAuth, authorize(['admin', 'sales', 'marketing']), validateBody(schemas.leadUpdate), (req, res, next) => {
  const result = leadService.update(req.params.id, req.validated.body, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Lead not found', 404));
  res.json(result.lead);
});

api.patch('/leads/:id/status', requireAuth, authorize(['admin', 'sales', 'marketing']), (req, res, next) => {
  const result = leadService.setStatus(req.params.id, req.body.status, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Lead not found', 404));
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  res.json(result.lead);
});

api.delete('/leads/:id', requireAuth, authorize(['admin', 'marketing']), (req, res, next) => {
  const result = leadService.remove(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Lead not found', 404));
  res.status(204).send();
});

api.get('/teams', (req, res) => {
  res.json(teamService.list(req.query, req.tenant.id));
});

api.post('/teams', requireAuth, authorize(['admin']), (req, res, next) => {
  const result = teamService.create(req.body, req.tenant.id);
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  res.status(201).json(result.team);
});

api.put('/teams/:id', requireAuth, authorize(['admin']), (req, res, next) => {
  const result = teamService.update(req.params.id, req.body, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Team not found', 404));
  res.json(result.team);
});

api.delete('/teams/:id', requireAuth, authorize(['admin']), (req, res, next) => {
  const result = teamService.remove(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Team not found', 404));
  res.status(204).send();
});

api.get('/reviews', (req, res) => {
  res.json(reviewService.list(req.query, req.tenant.id));
});

api.post('/reviews', validateBody(schemas.reviewCreate), (req, res, next) => {
  const result = reviewService.create(req.validated.body, req.tenant.id);
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  res.status(201).json(result.review);
});

api.put('/reviews/:id', requireAuth, authorize(['admin', 'sales']), (req, res, next) => {
  const result = reviewService.update(req.params.id, req.body, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Review not found', 404));
  res.json(result.review);
});

api.delete('/reviews/:id', requireAuth, authorize(['admin', 'sales']), (req, res, next) => {
  const result = reviewService.remove(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Review not found', 404));
  res.status(204).send();
});

api.get('/settings', requireAuth, authorize(['admin']), (req, res) => {
  res.json(settingsService.getForTenant(req.tenant.id));
});

api.put('/settings', requireAuth, authorize(['admin']), (req, res) => {
  const result = settingsService.update(req.body, req.tenant.id);
  res.json(result.settings);
});

api.get('/health', (req, res) => {
  res.json({ status: 'ok', uptimeSeconds: process.uptime(), requestId: req.requestId });
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

app.use('/v1', api);

app.use(errorHandler);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
