const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;
const DATA_DIR = `${__dirname}/data`;
const VALID_LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];

app.use(bodyParser.json());
app.use(cors());

// Shared helpers -----------------------------------------------------------

function loadData(file, defaultValue) {
  try {
    const data = fs.readFileSync(`${DATA_DIR}/${file}`, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return defaultValue;
  }
}

function saveData(file, data) {
  fs.writeFileSync(`${DATA_DIR}/${file}`, JSON.stringify(data, null, 2));
}

function respondNotFound(res, entity = 'Resource') {
  return res.status(404).json({ message: `${entity} not found` });
}

function validateFields(payload, requiredFields = []) {
  const missing = requiredFields.filter(field => payload[field] === undefined || payload[field] === null || payload[field] === '');
  if (missing.length) {
    return `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`;
  }
  return null;
}

function clampNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return fallback;
}

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
});

/*
  CAPABILITY ROUTES
  Provide a machine-readable version of the 100 must-have capabilities
  outlined in the README so other services and front-ends can consume
  the checklist directly from the API.
*/
app.get('/capabilities', (req, res) => {
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

app.get('/capabilities/:id', (req, res) => {
  const id = Number(req.params.id);
  const capability = capabilities.find(item => item.id === id);
  if (!capability) {
    return respondNotFound(res, 'Capability');
  }
  res.json(capability);
});

/*
  INVENTORY ROUTES
  Endpoints for managing RV inventory units.
  Each unit has an id, stockNumber, industry, category, subcategory,
  condition (e.g. New, Used), msrp, price, salePrice, location,
  daysOnLot, images array and featured boolean.
*/
app.get('/inventory', (req, res) => {
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

app.get('/inventory/:id', (req, res) => {
  const unit = inventory.find(u => u.id === req.params.id);
  if (!unit) {
    return res.status(404).json({ message: 'Unit not found' });
  }
  res.json(unit);
});

app.post('/inventory', (req, res) => {
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
  res.status(201).json(unit);
});

app.put('/inventory/:id', (req, res) => {
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
  res.json(updated);
});

app.patch('/inventory/:id/feature', (req, res) => {
  const index = inventory.findIndex(u => u.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Unit');
  }

  const featured = sanitizeBoolean(req.body.featured, true);
  inventory[index] = { ...inventory[index], featured };
  saveData('inventory.json', inventory);
  res.json(inventory[index]);
});

app.delete('/inventory/:id', (req, res) => {
  const index = inventory.findIndex(u => u.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Unit');
  }
  const removed = inventory.splice(index, 1);
  saveData('inventory.json', inventory);
  res.json(removed[0]);
});

app.get('/inventory/stats', (req, res) => {
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
app.get('/teams', (req, res) => {
  res.json(teams);
});

app.get('/teams/:id', (req, res) => {
  const team = teams.find(t => t.id === req.params.id);
  if (!team) {
    return res.status(404).json({ message: 'Team not found' });
  }
  res.json(team);
});

app.post('/teams', (req, res) => {
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
  res.status(201).json(team);
});

app.put('/teams/:id', (req, res) => {
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
  res.json(teams[index]);
});

app.delete('/teams/:id', (req, res) => {
  const index = teams.findIndex(t => t.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Team');
  }
  const removed = teams.splice(index, 1);
  saveData('teams.json', teams);
  res.json(removed[0]);
});

app.get('/teams/roles', (req, res) => {
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
app.get('/reviews', (req, res) => {
  res.json(reviews);
});

app.get('/reviews/:id', (req, res) => {
  const review = reviews.find(r => r.id === req.params.id);
  if (!review) {
    return res.status(404).json({ message: 'Review not found' });
  }
  res.json(review);
});

app.post('/reviews', (req, res) => {
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
  res.status(201).json(review);
});

app.put('/reviews/:id', (req, res) => {
  const index = reviews.findIndex(r => r.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Review');
  }

  const rating = req.body.rating ? clampNumber(req.body.rating, reviews[index].rating) : reviews[index].rating;
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ message: 'Rating must be between 1 and 5' });
  }

  reviews[index] = {
    ...reviews[index],
    ...req.body,
    rating,
    visible: sanitizeBoolean(req.body.visible, reviews[index].visible)
  };
  saveData('reviews.json', reviews);
  res.json(reviews[index]);
});

app.patch('/reviews/:id/visibility', (req, res) => {
  const index = reviews.findIndex(r => r.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Review');
  }

  reviews[index] = {
    ...reviews[index],
    visible: sanitizeBoolean(req.body.visible, !reviews[index].visible)
  };
  saveData('reviews.json', reviews);
  res.json(reviews[index]);
});

app.delete('/reviews/:id', (req, res) => {
  const index = reviews.findIndex(r => r.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Review');
  }
  const removed = reviews.splice(index, 1);
  saveData('reviews.json', reviews);
  res.json(removed[0]);
});

app.get('/reviews/summary', (req, res) => {
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
app.get('/leads/:id', (req, res) => {
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) {
    return res.status(404).json({ message: 'Lead not found' });
  }
  res.json(lead);
});

app.post('/leads', (req, res) => {
  const requiredError = validateFields(req.body, ['name', 'email', 'message']);
  if (requiredError) {
    return res.status(400).json({ message: requiredError });
  }

  const lead = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    status: VALID_LEAD_STATUSES.includes(req.body.status) ? req.body.status : 'new',
    subject: req.body.subject || 'General inquiry',
    ...req.body
  };
  leads.push(lead);
  saveData('leads.json', leads);
  res.status(201).json(lead);
});

app.put('/leads/:id', (req, res) => {
  const index = leads.findIndex(l => l.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Lead');
  }

  const status = req.body.status && VALID_LEAD_STATUSES.includes(req.body.status)
    ? req.body.status
    : leads[index].status;

  leads[index] = { ...leads[index], ...req.body, status };
  saveData('leads.json', leads);
  res.json(leads[index]);
});

app.patch('/leads/:id/status', (req, res) => {
  const index = leads.findIndex(l => l.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Lead');
  }

  if (!VALID_LEAD_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ message: `Status must be one of: ${VALID_LEAD_STATUSES.join(', ')}` });
  }

  leads[index] = { ...leads[index], status: req.body.status };
  saveData('leads.json', leads);
  res.json(leads[index]);
});

app.delete('/leads/:id', (req, res) => {
  const index = leads.findIndex(l => l.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Lead');
  }
  const removed = leads.splice(index, 1);
  saveData('leads.json', leads);
  res.json(removed[0]);
});

app.get('/leads', (req, res) => {
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
app.get('/settings', (req, res) => {
  res.json(settings);
});

app.put('/settings', (req, res) => {
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
  res.json(settings);
});

// Basic root route with description
app.get('/', (req, res) => {
  res.json({
    message:
      'RV Dealer Backend API is running. Available resources: /inventory, /teams, /reviews, /leads, /settings'
  });
});

app.listen(port, () => {
  console.log(`Backend server listening on port ${port}`);
});