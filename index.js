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
const DATA_DIR = `${__dirname}/data`;
const VALID_LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];
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

// Shared helpers -----------------------------------------------------------

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

function clampNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

  const sorted = [...filtered].sort((a, b) => {
    const direction = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'price') return (Number(a.price) - Number(b.price)) * direction;
    if (sortBy === 'msrp') return (Number(a.msrp) - Number(b.msrp)) * direction;
    if (sortBy === 'daysOnLot') return (Number(a.daysOnLot) - Number(b.daysOnLot)) * direction;
    const aDate = new Date(a.createdAt || 0).getTime();
    const bDate = new Date(b.createdAt || 0).getTime();
    return (aDate - bDate) * direction;
  });

  const start = clampNumber(offset, 0);
  const end = limit ? start + clampNumber(limit, filtered.length) : filtered.length;

  res.json({
    total: sorted.length,
    items: sorted.slice(start, end)
  });
});

api.get('/inventory/:id', (req, res) => {
  const unit = inventory.find(u => u.id === req.params.id);
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
  const requiredError = validateFields(req.body, ['stockNumber', 'name', 'condition', 'price']);
  if (requiredError) {
    return res.status(400).json({ message: requiredError });
  }

  const unit = {
    id: uuidv4(),
    featured: sanitizeBoolean(req.body.featured, false),
    createdAt: new Date().toISOString(),
    images: Array.isArray(req.body.images) ? req.body.images : [],
    ...req.body
  };

  inventory.push(unit);
  saveData('inventory.json', inventory);
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
  const index = inventory.findIndex(u => u.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Unit');
  }

  const updated = {
    ...inventory[index],
    ...req.body,
    featured: sanitizeBoolean(req.body.featured, inventory[index].featured)
  };

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

  const averagePrice =
    inventory.length > 0
      ? inventory.reduce((sum, unit) => sum + Number(unit.price || 0), 0) / inventory.length
      : 0;

  res.json({
    totalUnits: inventory.length,
    byCondition,
    averagePrice
  });
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
  res.json(teams);
});

api.get('/teams/:id', (req, res) => {
  const team = teams.find(t => t.id === req.params.id);
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
api.get('/leads/:id', (req, res) => {
  const lead = leadService.findById(req.params.id);
  const lead = leads.find(l => l.id === req.params.id);
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

app.listen(port, () => {
  console.log(`Backend server listening on port ${port}`);
});
