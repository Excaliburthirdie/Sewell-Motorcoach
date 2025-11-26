const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { DATA_DIR } = require('./src/persistence/store');
const capabilityService = require('./src/services/capabilityService');
const inventoryService = require('./src/services/inventoryService');
const teamService = require('./src/services/teamService');
const reviewService = require('./src/services/reviewService');
const leadService = require('./src/services/leadService');
const settingsService = require('./src/services/settingsService');
const { datasets } = require('./src/services/state');

const app = express();
const port = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || process.env.ADMIN_API_KEY;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 300);

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
  if (process.env.ENFORCE_HTTPS === 'true' && req.headers['x-forwarded-proto'] === 'http') {
    return res.status(400).json({ message: 'HTTPS is required' });
  }
  next();
});

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

/*
  INVENTORY ROUTES
  Endpoints for managing RV inventory units.
  Each unit has an id, stockNumber, industry, category, subcategory,
  condition (e.g. New, Used), msrp, price, salePrice, location,
  daysOnLot, images array and featured boolean.
*/
api.get('/inventory', (req, res) => {
  res.json(inventoryService.list(req.query));
});

api.get('/inventory/:id', (req, res) => {
  const unit = inventoryService.findById(req.params.id);
  if (!unit) {
    return respondNotFound(res, 'Unit');
  }
  res.json(unit);
});

api.post('/inventory', requireAuth, (req, res) => {
  const { unit, error } = inventoryService.create(req.body);
  if (error) {
    return res.status(400).json({ message: error });
  }
  auditChange(req, 'create', 'inventory', unit);
  res.status(201).json(unit);
});

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
});

/*
  TEAM (Staff) ROUTES
  Each team has an id, name and an array of members. Each member has
  firstName, lastName, jobRole, biography and optional socialLinks array.
*/
api.get('/teams', (req, res) => {
  res.json(teamService.list());
});

api.get('/teams/:id', (req, res) => {
  const team = teamService.findById(req.params.id);
  if (!team) {
    return respondNotFound(res, 'Team');
  }
  res.json(team);
});

api.post('/teams', requireAuth, (req, res) => {
  const { team, error } = teamService.create(req.body);
  if (error) {
    return res.status(400).json({ message: error });
  }
  auditChange(req, 'create', 'team', team);
  res.status(201).json(team);
});

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
});

/*
  REVIEW ROUTES
  Reviews represent customer testimonials. Each review has id,
  name, rating (number between 1 and 5), content and visibility boolean.
*/
api.get('/reviews', (req, res) => {
  res.json(reviewService.list());
});

api.get('/reviews/:id', (req, res) => {
  const review = reviewService.findById(req.params.id);
  if (!review) {
    return respondNotFound(res, 'Review');
  }
  res.json(review);
});

api.post('/reviews', requireAuth, (req, res) => {
  const { review, error } = reviewService.create(req.body);
  if (error) {
    return res.status(400).json({ message: error });
  }
  auditChange(req, 'create', 'review', review);
  res.status(201).json(review);
});

api.put('/reviews/:id', requireAuth, (req, res) => {
  const { review, error, notFound } = reviewService.update(req.params.id, req.body);
  if (notFound) {
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
});

/*
  LEAD ROUTES
  Leads represent submissions from contact forms. Each lead has id,
  name, email, subject, message and createdAt timestamp.
*/
api.get('/leads/:id', (req, res) => {
  const lead = leadService.findById(req.params.id);
  if (!lead) {
    return respondNotFound(res, 'Lead');
  }
  res.json(lead);
});

api.post('/leads', requireAuth, (req, res) => {
  const { lead, error } = leadService.create(req.body);
  if (error) {
    return res.status(400).json({ message: error });
  }
  auditChange(req, 'create', 'lead', lead);
  res.status(201).json(lead);
});

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
});

/*
  SETTINGS ROUTES
  Settings store dealership contact information and configuration. This
  endpoint returns and updates the single settings object.
*/
api.get('/settings', (req, res) => {
  res.json(settingsService.get());
});

api.put('/settings', requireAuth, (req, res) => {
  const { settings, error } = settingsService.update(req.body);
  if (error) {
    return res.status(400).json({ message: error });
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

app.listen(port, () => {
  console.log(`Backend server listening on port ${port}`);
});
