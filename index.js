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

tenantService.initializeTenants();

const app = express();
const port = config.server.port;
const API_KEY = config.auth.apiKey;
const RATE_LIMIT_WINDOW_MS = config.rateLimit.windowMs;
const RATE_LIMIT_MAX = config.rateLimit.max;

const rateLimitBuckets = new Map();

app.use(bodyParser.json());
app.use(cors());

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
    requestId: requestId(req),
    tenantId: req.tenant?.id,
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
  }
  res.json(team);
});

api.post('/teams', requireAuth, authorize(['admin', 'marketing']), validateBody(schemas.teamCreate), (req, res, next) => {
  const { team, error } = teamService.create(req.validated.body, req.tenant.id);
  if (error) {
    return next(new AppError('VALIDATION_ERROR', error, 400));
  }
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
  }
  res.json(review);
});

api.post('/reviews', requireAuth, authorize(['admin', 'marketing']), validateBody(schemas.reviewCreate), (req, res, next) => {
  const { review, error } = reviewService.create(req.validated.body, req.tenant.id);
  if (error) {
    return next(new AppError('VALIDATION_ERROR', error, 400));
  }
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
  }
  res.json(lead);
});

api.post('/leads', requireAuth, authorize(['admin', 'sales', 'marketing']), validateBody(schemas.leadCreate), (req, res, next) => {
  const { lead, error } = leadService.create(req.validated.body, req.tenant.id);
  if (error) {
    return next(new AppError('VALIDATION_ERROR', error, 400));
  }
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
