const express = require('./src/lib/miniExpress');
const cors = require('./src/lib/cors');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');
const zlib = require('node:zlib');

const config = require('./src/config');
const { DATA_DIR } = require('./src/persistence/store');
const capabilityService = require('./src/services/capabilityService');
const inventoryService = require('./src/services/inventoryService');
const inventorySchemaService = require('./src/services/inventorySchemaService');
const teamService = require('./src/services/teamService');
const reviewService = require('./src/services/reviewService');
const leadService = require('./src/services/leadService');
const leadScoringService = require('./src/services/leadScoringService');
const settingsService = require('./src/services/settingsService');
const contentPageService = require('./src/services/contentPageService');
const eventService = require('./src/services/eventService');
const customerService = require('./src/services/customerService');
const serviceTicketService = require('./src/services/serviceTicketService');
const financeOfferService = require('./src/services/financeOfferService');
const authService = require('./src/services/authService');
const { datasets } = require('./src/services/state');
const seoService = require('./src/services/seoService');
const analyticsService = require('./src/services/analyticsService');
const pageLayoutService = require('./src/services/pageLayoutService');
const aiService = require('./src/services/aiService');
const tenantService = require('./src/services/tenantService');
const webhookService = require('./src/services/webhookService');
const auditLogService = require('./src/services/auditLogService');
const exportService = require('./src/services/exportService');
const redirectService = require('./src/services/redirectService');
const inventoryRevisionService = require('./src/services/inventoryRevisionService');
const spotlightTemplateService = require('./src/services/spotlightTemplateService');
const blockPresetService = require('./src/services/blockPresetService');
const experimentService = require('./src/services/experimentService');
const taskService = require('./src/services/taskService');
const notificationService = require('./src/services/notificationService');
const leadEngagementService = require('./src/services/leadEngagementService');
const campaignService = require('./src/services/campaignService');
const { validateBody, validateParams, validateQuery } = require('./src/middleware/validation');
const { schemas } = require('./src/validation/schemas');
const { AppError, errorHandler } = require('./src/middleware/errors');
const { sanitizeString } = require('./src/services/shared');
const { ensureCsrfToken, issueCsrfToken, requireCsrfToken } = require('./src/middleware/csrf');
const { maskSensitiveFields } = require('./src/services/security');

tenantService.initializeTenants();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
const port = config.server.port;
const API_KEY = config.auth.apiKey;
const RATE_LIMIT_WINDOW_MS = config.rateLimit.windowMs;
const RATE_LIMIT_MAX = config.rateLimit.max;
const COOKIE_SECURE = config.env === 'production' || config.server.enforceHttps;
const BASE_COOKIE_OPTIONS = {
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SECURE ? 'none' : 'lax'
};
const REFRESH_COOKIE_OPTIONS = {
  ...BASE_COOKIE_OPTIONS,
  httpOnly: true,
  path: '/v1/auth/refresh',
  maxAge: config.auth.refreshTokenTtlSeconds * 1000
};

const rateLimitBuckets = new Map();
const loginAttempts = new Map();
const routeMetrics = new Map();
const RATE_LIMIT_CLEANUP_MS = RATE_LIMIT_WINDOW_MS * 2;
const LOGIN_ATTEMPT_TTL_MS = 10 * 60 * 1000;

function recordLoginAttempt(ip, success) {
  if (success) {
    loginAttempts.delete(ip);
    return;
  }
  const existing = loginAttempts.get(ip) || { failures: 0, lastAttempt: 0 };
  loginAttempts.set(ip, { failures: existing.failures + 1, lastAttempt: Date.now() });
}

function getLoginBackoff(ip) {
  const record = loginAttempts.get(ip);
  if (!record) return 0;
  const delay = 1000 * 2 ** Math.max(0, record.failures - 1);
  const elapsed = Date.now() - record.lastAttempt;
  return Math.max(0, delay - elapsed);
}

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

function startInMemoryStateCleanup() {
  const cleanup = () => {
    const now = Date.now();
    for (const [ip, timestamps] of rateLimitBuckets.entries()) {
      const recent = timestamps.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);
      if (recent.length === 0) {
        rateLimitBuckets.delete(ip);
      } else {
        rateLimitBuckets.set(ip, recent);
      }
    }

    for (const [ip, record] of loginAttempts.entries()) {
      if (now - record.lastAttempt > LOGIN_ATTEMPT_TTL_MS) {
        loginAttempts.delete(ip);
      }
    }
  };

  setInterval(cleanup, RATE_LIMIT_CLEANUP_MS).unref();
  cleanup();
}

function applySecurityHeaders(_req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-DNS-Prefetch-Control': 'off',
    'X-Permitted-Cross-Domain-Policies': 'none'
  });
  next();
}

function gzipResponses(req, res, next) {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  if (!acceptEncoding.includes('gzip')) {
    return next();
  }

  const originalSend = res.send.bind(res);
  res.send = body => {
    if (body === undefined || body === null) {
      return originalSend(body);
    }

    let payload = body;
    if (!Buffer.isBuffer(body)) {
      if (typeof body === 'object') {
        payload = Buffer.from(JSON.stringify(body));
        if (!res.get('Content-Type')) {
          res.type('application/json');
        }
      } else {
        payload = Buffer.from(String(body));
      }
    }

    zlib.gzip(payload, (err, compressed) => {
      if (err) {
        console.error('gzip failed', { message: err.message });
        return originalSend(body);
      }
      res.set('Content-Encoding', 'gzip');
      res.set('Vary', 'Accept-Encoding');
      return originalSend(compressed);
    });
  };

  next();
}

startInMemoryStateCleanup();
if (config.server.compressionEnabled) {
  app.use(gzipResponses);
}
app.use(applySecurityHeaders);
app.use(
  express.json({
    limit: `${config.server.jsonLimitMb}mb`
  })
);
app.use(express.urlencoded({ extended: true, limit: `${config.server.jsonLimitMb}mb` }));
app.use(parseCookies);
app.use(cors({ origin: true, credentials: true }));
app.use(express.static(path.join(__dirname, 'public')));

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
  const requestId = req.headers['x-request-id'] || randomUUID();
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
    const key = `${req.method} ${req.route?.path || req.path.split('?')[0] || req.originalUrl.split('?')[0]}`;
    const record = routeMetrics.get(key) || { count: 0, totalMs: 0, statusCounts: {} };
    record.count += 1;
    record.totalMs += durationMs;
    record.statusCounts[res.statusCode] = (record.statusCounts[res.statusCode] || 0) + 1;
    routeMetrics.set(key, record);
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

app.use(ensureCsrfToken);
app.use(requireCsrfToken);

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
    payload: maskSensitiveFields(payload)
  };
  fs.appendFile(`${DATA_DIR}/audit.log`, `${JSON.stringify(auditRecord)}\n`, () => {});
}

function checkDataDirWritable() {
  try {
    const probePath = path.join(DATA_DIR, '.healthcheck');
    fs.writeFileSync(probePath, 'ok');
    fs.unlinkSync(probePath);
    return true;
  } catch (err) {
    console.error('Data directory not writable', { message: err.message });
    return false;
  }
}

// Routes -------------------------------------------------------------------
const api = express.Router();

api.post('/auth/login', validateBody(schemas.authLogin), (req, res, next) => {
  const { username, password, tenantId } = req.validated.body;
  const penalty = getLoginBackoff(req.ip);
  if (penalty > 0) {
    return next(
      new AppError('RATE_LIMIT_EXCEEDED', `Too many login attempts. Retry in ${Math.ceil(penalty / 1000)}s`, 429)
    );
  }
  const tenant = tenantService.resolveTenantId(tenantId || req.tenant?.id);
  if (!tenant) {
    return next(new AppError('TENANT_NOT_FOUND', 'Tenant not found for login', 404));
  }
  const result = authService.authenticate(username, password, tenant);
  if (!result) {
    recordLoginAttempt(req.ip, false);
    return next(new AppError('UNAUTHORIZED', 'Invalid username or password', 401));
  }
  recordLoginAttempt(req.ip, true);
  const csrfToken = issueCsrfToken(res);
  res.cookie('refreshToken', result.tokens.refreshToken, REFRESH_COOKIE_OPTIONS);
  res.json({
    user: { ...result.user, tenantId: tenant },
    accessToken: result.tokens.accessToken,
    tokenType: 'Bearer',
    expiresInSeconds: config.auth.accessTokenTtlSeconds,
    csrfToken
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
    const csrfToken = issueCsrfToken(res);
    res.cookie('refreshToken', tokens.refreshToken, REFRESH_COOKIE_OPTIONS);
    res.json({
      user,
      accessToken: tokens.accessToken,
      tokenType: 'Bearer',
      expiresInSeconds: config.auth.accessTokenTtlSeconds,
      csrfToken
    });
  } catch (err) {
    return next(new AppError('UNAUTHORIZED', err.message || 'Invalid refresh token', 401));
  }
});

api.post('/auth/logout', validateBody(schemas.authLogout), (req, res, next) => {
  try {
    const token = req.validated.body.refreshToken || req.cookies?.refreshToken;
    if (!token) {
      return next(new AppError('UNAUTHORIZED', 'Refresh token missing', 401));
    }
    const record = authService.revokeRefreshToken(token);
    res.clearCookie('refreshToken', REFRESH_COOKIE_OPTIONS);
    res.json({ revoked: record.jti, expiresAt: record.expiresAt });
  } catch (err) {
    return next(new AppError('UNAUTHORIZED', err.message || 'Invalid refresh token', 401));
  }
});

api.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
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

api.get('/inventory', validateQuery(schemas.inventoryListQuery), (req, res) => {
  res.json(inventoryService.list(req.validated.query, req.tenant.id));
});

api.get('/inventory/stats', (req, res) => {
  res.json(inventoryService.stats(req.tenant.id));
});

api.get('/inventory/slug/:slug', (req, res, next) => {
  const unit = inventoryService.findBySlug(req.params.slug, req.tenant.id);
  if (!unit) return next(new AppError('NOT_FOUND', 'Inventory not found', 404));
  res.json(unit);
});

api.get('/inventory/:id', validateParams(schemas.idParam), (req, res, next) => {
  const unit = inventoryService.findById(req.validated.params.id, req.tenant.id);
  if (!unit) return next(new AppError('NOT_FOUND', 'Inventory not found', 404));
  res.json(unit);
});

api.get(
  '/inventory/:id/revisions',
  requireAuth,
  authorize(['admin', 'sales', 'marketing']),
  validateParams(schemas.idParam),
  (req, res) => {
    res.json({ revisions: inventoryRevisionService.listRevisions(req.validated.params.id, req.tenant.id) });
  }
);

api.post(
  '/inventory/:id/revisions/:revisionId/restore',
  requireAuth,
  authorize(['admin']),
  validateParams(schemas.idParam),
  (req, res, next) => {
    const result = inventoryRevisionService.restoreRevision(
      req.params.id,
      req.params.revisionId,
      req.tenant.id,
      req.user?.email || req.user?.id
    );
    if (result.notFound) return next(new AppError('NOT_FOUND', 'Revision not found', 404));
    auditChange(req, 'restore', 'inventory_revision', { revisionId: req.params.revisionId, id: req.params.id });
    res.json({ unit: result.unit, revision: result.revision });
  }
);

api.get('/inventory/:id/schema', validateParams(schemas.idParam), (req, res, next) => {
  const result = inventorySchemaService.getSchemaForInventory(req.validated.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Inventory not found', 404));
  res.json(result.schema);
});

api.post('/inventory', requireAuth, authorize(['admin', 'sales']), validateBody(schemas.inventoryCreate), (req, res, next) => {
  const result = inventoryService.create(req.validated.body, req.tenant.id);
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  if (result.conflict) return next(new AppError('CONFLICT', result.conflict, 409));
  auditChange(req, 'create', 'inventory', result.unit);
  webhookService.trigger('inventory.created', result.unit, req.tenant.id);
  res.status(201).json(result.unit);
});

api.put('/inventory/:id', requireAuth, authorize(['admin', 'sales']), validateBody(schemas.inventoryUpdate), (req, res, next) => {
  const result = inventoryService.update(
    req.params.id,
    { ...req.validated.body, updatedBy: req.user?.email || req.user?.id },
    req.tenant.id
  );
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Inventory not found', 404));
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  auditChange(req, 'update', 'inventory', result.unit);
  if (result.pricingChanges?.length) {
    auditChange(req, 'price_change', 'inventory', { id: result.unit.id, changes: result.pricingChanges });
  }
  webhookService.trigger('inventory.updated', result.unit, req.tenant.id);
  res.json(result.unit);
});

api.patch(
  '/inventory/:id/story',
  requireAuth,
  authorize(['admin', 'sales']),
  validateBody(schemas.inventoryStoryUpdate),
  (req, res, next) => {
    const result = inventoryService.updateStory(
      req.params.id,
      req.validated.body.salesStory,
      req.tenant.id,
      req.user?.email || req.user?.id
    );
    if (result.notFound) return next(new AppError('NOT_FOUND', 'Inventory not found', 404));
    auditChange(req, 'update', 'inventory_story', result.unit);
    res.json(result.unit);
  }
);

api.patch(
  '/inventory/:id/spotlights',
  requireAuth,
  authorize(['admin', 'sales', 'marketing']),
  validateBody(schemas.inventorySpotlightsUpdate),
  (req, res, next) => {
    const result = inventoryService.updateSpotlights(
      req.params.id,
      req.validated.body.spotlights,
      req.tenant.id,
      req.user?.email || req.user?.id
    );
    if (result.notFound) return next(new AppError('NOT_FOUND', 'Inventory not found', 404));
    auditChange(req, 'update', 'inventory_spotlights', result.unit);
    res.json(result.unit);
  }
);

api.patch(
  '/inventory/:id/hotspots',
  requireAuth,
  authorize(['admin', 'sales', 'marketing']),
  validateBody(schemas.inventoryHotspotsUpdate),
  (req, res, next) => {
    const result = inventoryService.updateMediaHotspots(
      req.params.id,
      req.validated.body.mediaHotspots,
      req.tenant.id,
      req.user?.email || req.user?.id
    );
    if (result.notFound) return next(new AppError('NOT_FOUND', 'Inventory not found', 404));
    auditChange(req, 'update', 'inventory_hotspots', result.unit);
    res.json(result.unit);
  }
);

api.patch(
  '/inventory/:id/media',
  requireAuth,
  authorize(['admin', 'sales', 'marketing']),
  validateBody(schemas.inventoryMediaUpdate),
  (req, res, next) => {
    const result = inventoryService.updateMedia(req.params.id, req.validated.body.media, req.tenant.id);
    if (result.notFound) return next(new AppError('NOT_FOUND', 'Inventory not found', 404));
    auditChange(req, 'update', 'inventory_media', result.unit);
    res.json(result.unit);
  }
);

api.post(
  '/inventory/badges/preview',
  requireAuth,
  authorize(['admin', 'sales', 'marketing']),
  validateBody(schemas.badgePreview),
  (req, res) => {
    res.json({ badges: inventoryService.previewBadges(req.validated.body, req.tenant.id) });
  }
);

api.post(
  '/inventory/bulk/spotlights/apply-template',
  requireAuth,
  authorize(['admin', 'marketing']),
  validateBody(schemas.spotlightTemplateApply),
  (req, res, next) => {
    const result = spotlightTemplateService.applyTemplate(
      req.validated.body.templateId,
      req.validated.body.inventoryIds,
      req.tenant.id
    );
    if (result.notFound) return next(new AppError('NOT_FOUND', 'Template not found', 404));
    auditChange(req, 'bulk_update', 'inventory_spotlights', { templateId: result.template.id, ids: result.applied });
    res.json(result);
  }
);

api.post(
  '/inventory/bulk/recompute-badges',
  requireAuth,
  authorize(['admin', 'marketing']),
  validateBody(schemas.badgeRecompute),
  (req, res) => {
    const result = inventoryService.recomputeBadges(req.validated.body, req.tenant.id);
    auditChange(req, 'bulk_update', 'inventory_badges', { ids: result.ids });
    res.json(result);
  }
);

api.get('/spotlight-templates', requireAuth, authorize(['admin', 'marketing']), (req, res) => {
  res.json({ templates: spotlightTemplateService.list(req.tenant.id) });
});

api.post(
  '/spotlight-templates',
  requireAuth,
  authorize(['admin', 'marketing']),
  validateBody(schemas.spotlightTemplateCreate),
  (req, res) => {
    const result = spotlightTemplateService.create(req.validated.body, req.tenant.id, req.user?.email || req.user?.id);
    auditChange(req, 'create', 'spotlight_template', result.template);
    res.status(201).json(result.template);
  }
);

api.patch(
  '/spotlight-templates/:id',
  requireAuth,
  authorize(['admin', 'marketing']),
  validateParams(schemas.idParam),
  validateBody(schemas.spotlightTemplateUpdate),
  (req, res, next) => {
    const result = spotlightTemplateService.update(req.params.id, req.validated.body, req.tenant.id);
    if (result.notFound) return next(new AppError('NOT_FOUND', 'Template not found', 404));
    auditChange(req, 'update', 'spotlight_template', result.template);
    res.json(result.template);
  }
);

api.delete('/spotlight-templates/:id', requireAuth, authorize(['admin', 'marketing']), validateParams(schemas.idParam), (req, res, next) => {
  const result = spotlightTemplateService.remove(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Template not found', 404));
  auditChange(req, 'delete', 'spotlight_template', { id: req.params.id });
  res.status(204).send();
});

api.post(
  '/inventory/import',
  requireAuth,
  authorize(['admin', 'sales']),
  validateBody(schemas.inventoryBulkImport),
  (req, res) => {
    const result = inventoryService.importCsv(req.validated.body.csv, req.validated.body.tenantId || req.tenant.id);
    res.status(result.errors.length ? 207 : 201).json(result);
  }
);

api.get('/content', (req, res) => {
  res.json(contentPageService.list(req.query, req.tenant.id));
});

api.get('/content/slug/:slug', (req, res, next) => {
  const page = contentPageService.findBySlug(req.params.slug, req.tenant.id);
  if (!page) return next(new AppError('NOT_FOUND', 'Content page not found', 404));
  res.json(page);
});

api.get('/pages/:slug', (req, res, next) => {
  const isPreview = req.query.mode === 'preview';
  const handleLookup = () => {
    const page = contentPageService.findBySlug(req.params.slug, req.tenant.id, { preview: isPreview });
    if (!page) return next(new AppError('NOT_FOUND', 'Content page not found', 404));
    res.json(page);
  };

  if (!isPreview) {
    return handleLookup();
  }

  return requireAuth(req, res, err => {
    if (err) return next(err);
    if (!['admin', 'marketing'].includes(req.user?.role)) {
      return next(new AppError('FORBIDDEN', 'Insufficient role for preview', 403));
    }
    return handleLookup();
  });
});

api.get('/content/:id', validateParams(schemas.idParam), (req, res, next) => {
  const page = contentPageService.findById(req.validated.params.id, req.tenant.id);
  if (!page) return next(new AppError('NOT_FOUND', 'Content page not found', 404));
  res.json(page);
});

api.post('/content', requireAuth, authorize(['admin', 'marketing']), validateBody(schemas.contentPageCreate), (req, res, next) => {
  const result = contentPageService.create(req.validated.body, req.tenant.id, req.user?.email || req.user?.id);
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  if (result.conflict) return next(new AppError('CONFLICT', result.conflict, 409));
  res.status(201).json(result.page);
});

api.put('/content/:id', requireAuth, authorize(['admin', 'marketing']), validateBody(schemas.contentPageUpdate), (req, res, next) => {
  const result = contentPageService.update(
    req.params.id,
    req.validated.body,
    req.tenant.id,
    req.user?.email || req.user?.id
  );
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Content page not found', 404));
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  if (result.conflict) return next(new AppError('CONFLICT', result.conflict, 409));
  res.json(result.page);
});

api.delete('/content/:id', requireAuth, authorize(['admin', 'marketing']), (req, res, next) => {
  const result = contentPageService.remove(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Content page not found', 404));
  res.status(204).send();
});

api.post(
  '/pages/:id/publish',
  requireAuth,
  authorize(['admin', 'marketing']),
  validateParams(schemas.idParam),
  validateBody(schemas.pagePublish),
  (req, res, next) => {
    const result = contentPageService.publish(
      req.params.id,
      req.tenant.id,
      req.validated.body.publishAt,
      req.user?.email || req.user?.id
    );
    if (result.notFound) return next(new AppError('NOT_FOUND', 'Content page not found', 404));
    res.json(result.page);
  }
);

api.get('/content/:id/layout', requireAuth, authorize(['admin', 'marketing']), validateParams(schemas.idParam), (req, res, next) => {
  const layout = pageLayoutService.getByPage(req.params.id, req.tenant.id);
  if (!layout) return next(new AppError('NOT_FOUND', 'Layout not found for content page', 404));
  res.json(layout);
});

api.post(
  '/content/:id/layout',
  requireAuth,
  authorize(['admin', 'marketing']),
  validateParams(schemas.idParam),
  validateBody(schemas.pageLayoutUpsert),
  (req, res, next) => {
    const result = pageLayoutService.saveDraft(req.params.id, req.validated.body, req.tenant.id);
    if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
    res.status(201).json(result.layout);
  }
);

api.post('/content/:id/layout/publish', requireAuth, authorize(['admin', 'marketing']), validateParams(schemas.idParam), (req, res, next) => {
  const result = pageLayoutService.publish(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Layout not found for content page', 404));
  res.json(result.layout);
});

api.get('/block-presets', requireAuth, authorize(['admin', 'marketing']), (req, res) => {
  res.json({ presets: blockPresetService.list(req.query, req.tenant.id) });
});

api.post(
  '/block-presets',
  requireAuth,
  authorize(['admin', 'marketing']),
  validateBody(schemas.blockPresetCreate),
  (req, res, next) => {
    const result = blockPresetService.create(req.validated.body, req.tenant.id, req.user?.email || req.user?.id);
    if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
    res.status(201).json(result.preset);
  }
);

api.patch(
  '/block-presets/:id',
  requireAuth,
  authorize(['admin', 'marketing']),
  validateParams(schemas.idParam),
  validateBody(schemas.blockPresetUpdate),
  (req, res, next) => {
    const result = blockPresetService.update(
      req.params.id,
      req.validated.body,
      req.tenant.id,
      req.user?.email || req.user?.id
    );
    if (result.notFound) return next(new AppError('NOT_FOUND', 'Block preset not found', 404));
    res.json(result.preset);
  }
);

api.delete('/block-presets/:id', requireAuth, authorize(['admin', 'marketing']), validateParams(schemas.idParam), (req, res, next) => {
  const result = blockPresetService.remove(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Block preset not found', 404));
  res.status(204).send();
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

api.get('/seo/profiles', requireAuth, authorize(['admin', 'marketing']), (req, res) => {
  const { resourceType, resourceId } = req.query;
  res.json(seoService.list({ resourceType, resourceId }, req.tenant.id));
});

api.post('/seo/profiles', requireAuth, authorize(['admin', 'marketing']), validateBody(schemas.seoProfileUpsert), (req, res, next) => {
  const result = seoService.upsert(req.validated.body, req.tenant.id);
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  res.status(201).json(result.profile);
});

api.post('/seo/autofill', requireAuth, authorize(['admin', 'marketing']), (req, res) => {
  const result = seoService.autofillMissing(req.tenant.id);
  res.json(result);
});

api.get('/seo/health', requireAuth, authorize(['admin', 'marketing']), (req, res) => {
  res.json(seoService.seoHealth(req.tenant.id));
});

api.get('/seo/topics', requireAuth, authorize(['admin', 'marketing']), (req, res) => {
  res.json(seoService.topics(req.tenant.id));
});

api.get('/leads', requireAuth, authorize(['admin', 'sales', 'marketing']), validateQuery(schemas.leadListQuery), (req, res) => {
  res.json(leadService.list(req.validated.query, req.tenant.id));
});

api.get('/leads/:id', requireAuth, authorize(['admin', 'sales', 'marketing']), (req, res, next) => {
  const lead = leadService.findById(req.params.id, req.tenant.id);
  if (!lead) return next(new AppError('NOT_FOUND', 'Lead not found', 404));
  res.json(lead);
});

api.get('/leads/:id/score', requireAuth, authorize(['admin', 'sales', 'marketing']), (req, res, next) => {
  const result = leadScoringService.recomputeLead(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Lead not found', 404));
  res.json(result);
});

api.post(
  '/leads/recompute-score',
  requireAuth,
  authorize(['admin', 'sales', 'marketing']),
  validateBody(schemas.leadScoreRecompute),
  (req, res) => {
    const result = leadScoringService.recomputeBulk(req.validated.body, req.tenant.id);
    res.json(result);
  }
);

api.get('/leads/:id/timeline', requireAuth, authorize(['admin', 'sales', 'marketing']), (req, res, next) => {
  const result = leadEngagementService.timeline(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Lead not found', 404));
  res.json(result);
});

api.post('/leads', validateBody(schemas.leadCreate), (req, res, next) => {
  const result = leadService.create(req.validated.body, req.tenant.id);
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  webhookService.trigger('lead.created', result.lead, req.tenant.id);
  res.status(201).json(result.lead);
});

api.put('/leads/:id', requireAuth, authorize(['admin', 'sales', 'marketing']), validateBody(schemas.leadUpdate), (req, res, next) => {
  const result = leadService.update(req.params.id, req.validated.body, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Lead not found', 404));
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  webhookService.trigger('lead.updated', result.lead, req.tenant.id);
  res.json(result.lead);
});

api.patch('/leads/:id/status', requireAuth, authorize(['admin', 'sales', 'marketing']), (req, res, next) => {
  const result = leadService.setStatus(req.params.id, req.body.status, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Lead not found', 404));
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  webhookService.trigger('lead.updated', result.lead, req.tenant.id);
  res.json(result.lead);
});

api.delete('/leads/:id', requireAuth, authorize(['admin', 'marketing']), (req, res, next) => {
  const result = leadService.remove(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Lead not found', 404));
  res.status(204).send();
});

api.get('/tasks', requireAuth, authorize(['admin', 'sales', 'marketing']), validateQuery(schemas.taskListQuery), (req, res) => {
  res.json(taskService.list(req.validated.query, req.tenant.id));
});

api.post('/tasks', requireAuth, authorize(['admin', 'sales', 'marketing']), validateBody(schemas.taskCreate), (req, res, next) => {
  const result = taskService.create(req.validated.body, req.tenant.id);
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  res.status(201).json(result.task);
});

api.patch('/tasks/:id', requireAuth, authorize(['admin', 'sales', 'marketing']), validateBody(schemas.taskUpdate), (req, res, next) => {
  const result = taskService.update(req.params.id, req.validated.body, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Task not found', 404));
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  res.json(result.task);
});

api.get(
  '/notifications',
  requireAuth,
  authorize(['admin', 'sales', 'marketing']),
  validateQuery(schemas.notificationListQuery),
  (req, res) => {
    res.json(notificationService.list(req.validated.query, req.tenant.id));
  }
);

api.patch(
  '/notifications/:id',
  requireAuth,
  authorize(['admin', 'sales', 'marketing']),
  validateBody(schemas.notificationStatusUpdate),
  (req, res, next) => {
    const result = notificationService.updateStatus(req.params.id, req.validated.body.status, req.tenant.id);
    if (result.notFound) return next(new AppError('NOT_FOUND', 'Notification not found', 404));
    if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
    res.json(result.notification);
  }
);

api.get('/customers', requireAuth, authorize(['admin', 'sales', 'marketing']), validateQuery(schemas.customerListQuery), (req, res) => {
  res.json(customerService.list(req.validated.query, req.tenant.id));
});

api.get('/customers/:id', requireAuth, authorize(['admin', 'sales', 'marketing']), (req, res, next) => {
  const customer = customerService.findById(req.params.id, req.tenant.id);
  if (!customer) return next(new AppError('NOT_FOUND', 'Customer not found', 404));
  res.json(customer);
});

api.post('/customers', requireAuth, authorize(['admin', 'sales', 'marketing']), validateBody(schemas.customerCreate), (req, res, next) => {
  const result = customerService.create(req.validated.body, req.tenant.id);
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  webhookService.trigger('customer.created', result.customer, req.tenant.id);
  res.status(201).json(result.customer);
});

api.put('/customers/:id', requireAuth, authorize(['admin', 'sales', 'marketing']), validateBody(schemas.customerUpdate), (req, res, next) => {
  const result = customerService.update(req.params.id, req.validated.body, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Customer not found', 404));
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  res.json(result.customer);
});

api.delete('/customers/:id', requireAuth, authorize(['admin']), (req, res, next) => {
  const result = customerService.remove(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Customer not found', 404));
  res.status(204).send();
});

api.get('/service-tickets', requireAuth, authorize(['admin', 'sales']), validateQuery(schemas.serviceTicketListQuery), (req, res) => {
  res.json(serviceTicketService.list(req.validated.query, req.tenant.id));
});

api.get('/service-tickets/:id', requireAuth, authorize(['admin', 'sales']), (req, res, next) => {
  const ticket = serviceTicketService.findById(req.params.id, req.tenant.id);
  if (!ticket) return next(new AppError('NOT_FOUND', 'Service ticket not found', 404));
  res.json(ticket);
});

api.post('/service-tickets', requireAuth, authorize(['admin', 'sales']), validateBody(schemas.serviceTicketCreate), (req, res, next) => {
  const result = serviceTicketService.create(req.validated.body, req.tenant.id);
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  webhookService.trigger('service-ticket.created', result.ticket, req.tenant.id);
  res.status(201).json(result.ticket);
});

api.put('/service-tickets/:id', requireAuth, authorize(['admin', 'sales']), validateBody(schemas.serviceTicketUpdate), (req, res, next) => {
  const result = serviceTicketService.update(req.params.id, req.validated.body, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Service ticket not found', 404));
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  res.json(result.ticket);
});

api.delete('/service-tickets/:id', requireAuth, authorize(['admin']), (req, res, next) => {
  const result = serviceTicketService.remove(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Service ticket not found', 404));
  res.status(204).send();
});

api.get('/finance-offers', validateQuery(schemas.financeOfferListQuery), (req, res) => {
  res.json(financeOfferService.list(req.validated.query, req.tenant.id));
});

api.get('/finance-offers/:id', (req, res, next) => {
  const offer = financeOfferService.findById(req.params.id, req.tenant.id);
  if (!offer) return next(new AppError('NOT_FOUND', 'Finance offer not found', 404));
  res.json(offer);
});

api.post('/finance-offers', requireAuth, authorize(['admin', 'marketing']), validateBody(schemas.financeOfferCreate), (req, res, next) => {
  const result = financeOfferService.create(req.validated.body, req.tenant.id);
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  webhookService.trigger('finance-offer.updated', result.offer, req.tenant.id);
  res.status(201).json(result.offer);
});

api.put('/finance-offers/:id', requireAuth, authorize(['admin', 'marketing']), validateBody(schemas.financeOfferUpdate), (req, res, next) => {
  const result = financeOfferService.update(req.params.id, req.validated.body, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Finance offer not found', 404));
  webhookService.trigger('finance-offer.updated', result.offer, req.tenant.id);
  res.json(result.offer);
});

api.delete('/finance-offers/:id', requireAuth, authorize(['admin']), (req, res, next) => {
  const result = financeOfferService.remove(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Finance offer not found', 404));
  res.status(204).send();
});

api.post('/events', validateBody(schemas.eventCreate), (req, res, next) => {
  const result = eventService.create(req.validated.body, req.tenant.id);
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  res.status(201).json(result.event);
});

api.get('/campaigns', requireAuth, authorize(['admin', 'marketing']), (req, res) => {
  res.json(campaignService.list(req.query, req.tenant.id));
});

api.post('/campaigns', requireAuth, authorize(['admin', 'marketing']), validateBody(schemas.campaignCreate), (req, res, next) => {
  const result = campaignService.create(req.validated.body, req.tenant.id);
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  res.status(201).json(result.campaign);
});

api.patch(
  '/campaigns/:id',
  requireAuth,
  authorize(['admin', 'marketing']),
  validateBody(schemas.campaignUpdate),
  (req, res, next) => {
    const result = campaignService.update(req.params.id, req.validated.body, req.tenant.id);
    if (result.notFound) return next(new AppError('NOT_FOUND', 'Campaign not found', 404));
    if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
    res.json(result.campaign);
  }
);

api.get('/reports/campaigns/performance', requireAuth, authorize(['admin', 'marketing']), (req, res) => {
  res.json(campaignService.performance(req.tenant.id));
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

api.get('/settings/badge-rules', requireAuth, authorize(['admin', 'marketing']), (req, res) => {
  res.json({ badgeRules: settingsService.getBadgeRules(req.tenant.id) });
});

api.patch(
  '/settings/badge-rules',
  requireAuth,
  authorize(['admin', 'marketing']),
  validateBody(schemas.badgeRulesUpdate),
  (req, res) => {
    const result = settingsService.updateBadgeRules(req.validated.body, req.tenant.id);
    res.json(result.badgeRules);
  }
);

api.get('/settings/lead-scoring', requireAuth, authorize(['admin', 'marketing']), (req, res) => {
  res.json({ leadScoringRules: settingsService.getLeadScoringRules(req.tenant.id) });
});

api.patch(
  '/settings/lead-scoring',
  requireAuth,
  authorize(['admin', 'marketing']),
  validateBody(schemas.leadScoringRulesUpdate),
  (req, res) => {
    const result = settingsService.updateLeadScoringRules(req.validated.body, req.tenant.id);
    res.json(result.leadScoringRules);
  }
);

api.get('/health', (req, res) => {
  const writable = checkDataDirWritable();
  const status = writable ? 'ok' : 'degraded';
  res.json({
    status,
    dataDirWritable: writable,
    uptimeSeconds: process.uptime(),
    requestId: req.requestId,
    tenants: {
      total: datasets.tenants.length,
      ids: datasets.tenants.map(t => t.id)
    }
  });
});

api.get('/sitemap', (req, res) => {
  const tenantId = req.tenant.id;
  const inventoryItems = inventoryService.list({}, tenantId).items;
  const inventory = inventoryItems.map(item => {
    const canonicalUrl = seoService.resolveCanonical('inventory', item.id, tenantId, () => item);
    return {
      type: 'inventory',
      slug: item.slug || item.id,
      id: item.id,
      canonicalUrl,
      lastmod: item.updatedAt || item.createdAt,
      priority: 0.8
    };
  });
  const pages = contentPageService.list({ status: 'published' }, tenantId).map(page => {
    const canonicalUrl = seoService.resolveCanonical('content', page.id, tenantId, () => page);
    return {
      type: 'content',
      slug: page.slug || page.id,
      id: page.id,
      canonicalUrl,
      lastmod: page.updatedAt || page.createdAt,
      priority: 0.6
    };
  });
  res.json({
    tenantId,
    generatedAt: new Date().toISOString(),
    entries: [...inventory, ...pages]
  });
});

api.post('/analytics/events', validateBody(schemas.analyticsEvent), (req, res) => {
  const result = analyticsService.recordEvent(req.validated.body, req.validated.body.tenantId || req.tenant.id);
  res.status(201).json(result.event);
});

api.post(
  '/experiments',
  requireAuth,
  authorize(['admin', 'marketing']),
  validateBody(schemas.experimentCreate),
  (req, res, next) => {
    const result = experimentService.create(req.validated.body, req.tenant.id, req.user?.email || req.user?.id);
    if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
    res.status(201).json(result.experiment);
  }
);

api.patch(
  '/experiments/:id',
  requireAuth,
  authorize(['admin', 'marketing']),
  validateParams(schemas.idParam),
  validateBody(schemas.experimentUpdate),
  (req, res, next) => {
    const result = experimentService.update(
      req.params.id,
      req.validated.body,
      req.tenant.id,
      req.user?.email || req.user?.id
    );
    if (result.notFound) return next(new AppError('NOT_FOUND', 'Experiment not found', 404));
    res.json(result.experiment);
  }
);

api.get('/experiments/:id', requireAuth, authorize(['admin', 'marketing']), validateParams(schemas.idParam), (req, res, next) => {
  const result = experimentService.getById(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Experiment not found', 404));
  res.json(result);
});

api.get('/analytics/dashboard', requireAuth, authorize(['admin', 'marketing']), (req, res) => {
  res.json(analyticsService.dashboard(req.tenant.id));
});

api.get('/ai/providers', requireAuth, authorize(['admin', 'marketing']), (req, res) => {
  res.json(aiService.listProviders(req.tenant.id));
});

api.post('/ai/providers', requireAuth, authorize(['admin', 'marketing']), validateBody(schemas.aiProviderCreate), (req, res) => {
  const result = aiService.registerProvider(req.validated.body, req.validated.body.tenantId || req.tenant.id);
  res.status(201).json(result.provider);
});

api.post('/ai/observe', validateBody(schemas.aiObservationCreate), (req, res) => {
  const result = aiService.recordObservation(req.validated.body, req.validated.body.tenantId || req.tenant.id);
  res.status(201).json(result.observation);
});

api.get('/ai/suggestions', requireAuth, authorize(['admin', 'marketing', 'sales']), (req, res) => {
  res.json(aiService.aiSuggestions(req.tenant.id));
});

api.post('/ai/web-fetch', requireAuth, authorize(['admin', 'marketing']), validateBody(schemas.aiWebFetchRequest), async (req, res) => {
  const result = await aiService.performWebFetch(req.validated.body.url, req.validated.body.tenantId || req.tenant.id, req.validated.body.note);
  res.status(201).json(result.fetch);
});

api.get('/ai/web-fetch', requireAuth, authorize(['admin', 'marketing']), (req, res) => {
  res.json(aiService.listWebFetches(req.tenant.id));
});

api.get('/webhooks', requireAuth, authorize(['admin', 'marketing']), validateQuery(schemas.webhookListQuery), (req, res) => {
  res.json(webhookService.list(req.validated.query, req.tenant.id));
});

api.get('/webhooks/deliveries', requireAuth, authorize(['admin', 'marketing']), validateQuery(schemas.webhookDeliveryQuery), (
req, res) => {
  res.json(webhookService.deliveries(req.validated.query, req.tenant.id));
});

api.post('/webhooks', requireAuth, authorize(['admin', 'marketing']), validateBody(schemas.webhookCreate), (req, res) => {
  const result = webhookService.create(req.validated.body, req.validated.body.tenantId || req.tenant.id);
  res.status(201).json(result.webhook);
});

api.put('/webhooks/:id', requireAuth, authorize(['admin', 'marketing']), validateBody(schemas.webhookUpdate), (req, res, next)
 => {
  const result = webhookService.update(req.params.id, req.validated.body, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Webhook not found', 404));
  res.json(result.webhook);
});

api.delete('/webhooks/:id', requireAuth, authorize(['admin', 'marketing']), (req, res, next) => {
  const result = webhookService.remove(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Webhook not found', 404));
  res.status(204).send();
});

api.get('/redirects', requireAuth, authorize(['admin', 'marketing']), (req, res) => {
  res.json(redirectService.list(req.tenant.id));
});

api.post('/redirects', requireAuth, authorize(['admin', 'marketing']), validateBody(schemas.redirectCreate), (req, res, next) => {
  const result = redirectService.create(req.validated.body, req.validated.body.tenantId || req.tenant.id);
  if (result.error) return next(new AppError('VALIDATION_ERROR', result.error, 400));
  res.status(201).json(result.redirect);
});

api.delete('/redirects/:id', requireAuth, authorize(['admin', 'marketing']), (req, res, next) => {
  const result = redirectService.remove(req.params.id, req.tenant.id);
  if (result.notFound) return next(new AppError('NOT_FOUND', 'Redirect not found', 404));
  res.status(204).send();
});

api.get('/audit/logs', requireAuth, authorize(['admin']), validateQuery(schemas.auditLogQuery), (req, res) => {
  res.json(auditLogService.list(req.validated.query));
});

api.get('/exports/snapshot', requireAuth, authorize(['admin']), (req, res) => {
  const result = exportService.generateCompressedSnapshot(req.tenant.id);
  res.json({
    fileName: result.fileName,
    sizeBytes: result.sizeBytes,
    generatedAt: result.snapshot.generatedAt,
    counts: result.snapshot.counts,
    tenantId: req.tenant.id,
    note: 'Snapshot compressed and stored on server. Download by reading file path from response.'
  });
});

api.get('/metrics', (req, res) => {
  const tenantId = req.tenant.id;
  const routePerformance = Array.from(routeMetrics.entries()).map(([key, value]) => ({
    route: key,
    averageMs: value.count ? value.totalMs / value.count : 0,
    total: value.count,
    statusCounts: value.statusCounts
  }));
  const rollup = eventService.dailyRollup(tenantId);
  res.json({
    counts: {
      inventory: datasets.inventory.length,
      teams: datasets.teams.length,
      reviews: datasets.reviews.length,
      leads: datasets.leads.length,
      capabilities: datasets.capabilities.length,
      customers: datasets.customers.length,
      serviceTickets: datasets.serviceTickets.length,
      financeOffers: datasets.financeOffers.length,
      events: datasets.events.length,
      contentPages: datasets.contentPages.length
    },
    routePerformance,
    rollup
  });
});

app.get(['/', '/dashboard'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.use('/v1', api);

app.use(errorHandler);

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = app;
