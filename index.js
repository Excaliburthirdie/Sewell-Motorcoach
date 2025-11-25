const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;
const DATA_DIR = `${__dirname}/data`;
const VALID_LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'];
const VALID_TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'done'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VALID_APPOINTMENT_TYPES = ['sales', 'service', 'delivery', 'virtual'];
const VALID_PAGE_STATUSES = ['draft', 'published', 'archived'];
const VALID_AUTOMATION_STATUSES = ['active', 'paused'];
const VALID_WEBHOOK_TOPICS = [
  'inventory.created',
  'inventory.updated',
  'lead.created',
  'lead.status_changed',
  'task.updated',
  'appointment.created'
];

app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Shared helpers -----------------------------------------------------------

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadData(file, defaultValue) {
  ensureDataDir();
  try {
    const data = fs.readFileSync(`${DATA_DIR}/${file}`, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.warn(`Could not load ${file}: ${err.message}`);
    return defaultValue;
  }
}

function saveData(file, data) {
  ensureDataDir();
  fs.writeFileSync(`${DATA_DIR}/${file}`, JSON.stringify(data, null, 2));
}

function respondNotFound(res, entity = 'Resource') {
  return res.status(404).json({ message: `${entity} not found` });
}

function validateFields(payload, requiredFields = []) {
  const missing = requiredFields.filter(
    field => payload[field] === undefined || payload[field] === null || payload[field] === ''
  );
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

function pickSort(items, sortBy, sortDir, comparators) {
  const direction = sortDir === 'asc' ? 1 : -1;
  if (!sortBy || !comparators[sortBy]) return items;
  const comparator = comparators[sortBy];
  return [...items].sort((a, b) => comparator(a, b) * direction);
}

function toSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 120);
}

function uniqueById(list) {
  const seen = new Set();
  return list.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function logActivity(action, entityType, detail, meta = {}) {
  const entry = {
    id: uuidv4(),
    action,
    entityType,
    detail,
    meta,
    createdAt: new Date().toISOString()
  };
  activity.unshift(entry);
  activity = activity.slice(0, 500);
  saveData('activity.json', activity);
  return entry;
}

// Load initial data from JSON files or defaults.
let inventory = loadData('inventory.json', []);
let teams = loadData('teams.json', []);
let reviews = loadData('reviews.json', []);
let leads = loadData('leads.json', []);
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
  },
  featureFlags: {
    maintenanceMode: false,
    captureAnalytics: true,
    autoAssignLeads: true,
    enableWebhooks: true
  },
  brand: {
    primaryColor: '#0d6efd',
    accentColor: '#6610f2',
    heroTagline: 'Luxury coaches, concierge service'
  },
  seo: {
    metaTitle: 'Sewell Motorcoach | Premium RV Dealer',
    metaDescription: 'Browse luxury motorcoaches with white-glove delivery and service.',
    keywords: ['rv', 'motorcoach', 'luxury', 'service']
  },
  sla: {
    leadResponseHours: 2,
    appointmentFollowupHours: 12,
    reviewResponseHours: 24
  }
});
let tasks = loadData('tasks.json', []);
let appointments = loadData('appointments.json', []);
let announcements = loadData('announcements.json', []);
let activity = loadData('activity.json', []);
let webhooks = loadData('webhooks.json', []);
let pages = loadData('pages.json', []);
let faqs = loadData('faqs.json', []);
let automations = loadData('automations.json', []);
let integrations = loadData('integrations.json', []);

/*
  ADMIN & DASHBOARD ROUTES
*/
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    totals: {
      inventory: inventory.length,
      leads: leads.length,
      reviews: reviews.length,
      teams: teams.length,
      tasks: tasks.length,
      appointments: appointments.length
    }
  });
});

app.get('/dashboard/summary', (req, res) => {
  const visibleReviews = reviews.filter(r => r.visible !== false);
  const averageRating =
    visibleReviews.length > 0
      ? visibleReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) /
        visibleReviews.length
      : 0;

  const leadStatusBreakdown = leads.reduce((acc, lead) => {
    acc[lead.status] = (acc[lead.status] || 0) + 1;
    return acc;
  }, {});

  const openTasks = tasks.filter(task => task.status !== 'done');
  const upcomingAppointments = appointments
    .filter(appt => new Date(appt.scheduledFor) > new Date())
    .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor))
    .slice(0, 5);

  res.json({
    inventory: {
      total: inventory.length,
      featured: inventory.filter(unit => unit.featured).length,
      averagePrice:
        inventory.length > 0
          ? inventory.reduce((sum, unit) => sum + Number(unit.price || 0), 0) / inventory.length
          : 0
    },
    leads: {
      total: leads.length,
      breakdown: leadStatusBreakdown,
      conversionRate:
        leads.length > 0 && leadStatusBreakdown.won
          ? Number(((leadStatusBreakdown.won / leads.length) * 100).toFixed(1))
          : 0
    },
    reviews: {
      averageRating: Number(averageRating.toFixed(2)),
      visibleCount: visibleReviews.length
    },
    tasks: {
      open: openTasks.length,
      overdue: openTasks.filter(task => task.dueDate && new Date(task.dueDate) < new Date()).length
    },
    appointments: {
      upcoming: upcomingAppointments,
      total: appointments.length
    },
    announcements
  });
});

app.get('/dashboard/insights', (req, res) => {
  const recentActivity = activity.slice(0, 15);
  const locations = inventory.reduce((acc, unit) => {
    const key = unit.location || 'unspecified';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const avgResponseHours = leads.length
    ? leads.reduce((total, lead) => total + Number(lead.responseHours || 0), 0) / leads.length
    : 0;

  res.json({
    recentActivity,
    leadResponseHours: Number(avgResponseHours.toFixed(1)),
    inventoryLocations: locations,
    topTeamMembers: teams
      .flatMap(team => team.members || [])
      .slice(0, 5)
      .map(member => ({
        name: `${member.firstName || ''} ${member.lastName || ''}`.trim(),
        jobRole: member.jobRole
      }))
  });
});

app.get('/dashboard/operations', (req, res) => {
  const now = new Date();
  const completedTasks = tasks.filter(task => task.status === 'done').length;
  const completionRate = tasks.length ? Math.round((completedTasks / tasks.length) * 100) : 0;
  const overdueTasks = tasks.filter(
    task => task.status !== 'done' && task.dueDate && new Date(task.dueDate) < now
  );
  const dueSoonTasks = tasks.filter(task => {
    if (!task.dueDate) return false;
    const dueDate = new Date(task.dueDate);
    const diffHours = (dueDate - now) / (1000 * 60 * 60);
    return diffHours >= 0 && diffHours <= 48;
  });

  const leadBreaches = leads.filter(
    lead => Number(lead.responseHours || 0) > (settings.sla?.leadResponseHours || 0)
  ).length;

  const upcomingAppointments = appointments
    .filter(appt => appt.status === 'scheduled' && new Date(appt.scheduledFor) > now)
    .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor))
    .slice(0, 5);

  const pipeline = leads.reduce(
    (acc, lead) => ({
      ...acc,
      [lead.status || 'unknown']: (acc[lead.status || 'unknown'] || 0) + 1
    }),
    {}
  );

  res.json({
    sla: {
      leadResponseHours: settings.sla?.leadResponseHours || 0,
      appointmentFollowupHours: settings.sla?.appointmentFollowupHours || 0,
      reviewResponseHours: settings.sla?.reviewResponseHours || 0,
      breaches: leadBreaches
    },
    productivity: {
      completionRate,
      overdue: overdueTasks.length,
      dueSoon: dueSoonTasks.length
    },
    upcomingAppointments,
    pipeline,
    siteStatus: {
      maintenanceMode: Boolean(settings.featureFlags?.maintenanceMode),
      uptime90d: 99.7,
      publishedPages: pages.filter(page => page.status === 'published').length
    }
  });
});

app.get('/dashboard/control-center', (req, res) => {
  const enabledWebhooks = webhooks.filter(hook => hook.enabled !== false);
  const automationSummary = automations.reduce(
    (acc, rule) => ({
      ...acc,
      [rule.status || 'unknown']: (acc[rule.status || 'unknown'] || 0) + 1
    }),
    {}
  );

  res.json({
    featureFlags: settings.featureFlags || {},
    integrations,
    webhooks: {
      total: webhooks.length,
      enabled: enabledWebhooks.length,
      failing: webhooks.filter(hook => hook.lastStatus && hook.lastStatus >= 400).length,
      items: enabledWebhooks.slice(0, 5)
    },
    automations: automationSummary
  });
});

app.get('/activity', (req, res) => {
  const { limit = 50, type } = req.query;
  const filtered = type ? activity.filter(entry => entry.entityType === type) : activity;
  res.json(filtered.slice(0, clampNumber(limit, 100)));
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
  logActivity('create', 'inventory', `Added ${unit.name || unit.stockNumber}`, { id: unit.id });
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
  logActivity('update', 'inventory', `Updated ${updated.name || updated.stockNumber}`, { id: updated.id });
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
  logActivity(
    'update',
    'inventory',
    `${inventory[index].name || inventory[index].stockNumber} featured set to ${featured}`,
    { id: inventory[index].id }
  );
  res.json(inventory[index]);
});

app.delete('/inventory/:id', (req, res) => {
  const index = inventory.findIndex(u => u.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Unit');
  }
  const removed = inventory.splice(index, 1);
  saveData('inventory.json', inventory);
  logActivity('delete', 'inventory', `Removed ${removed[0].name || removed[0].stockNumber}`, {
    id: removed[0].id
  });
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

  const totalFeatured = inventory.filter(unit => unit.featured).length;
  const averageDaysOnLot =
    inventory.length > 0
      ? inventory.reduce((sum, unit) => sum + Number(unit.daysOnLot || 0), 0) / inventory.length
      : 0;
  const valueByCondition = inventory.reduce((acc, unit) => {
    const price = Number(unit.price || 0);
    acc[unit.condition] = (acc[unit.condition] || 0) + price;
    return acc;
  }, {});
  const valueByLocation = inventory.reduce((acc, unit) => {
    const price = Number(unit.price || 0);
    const key = unit.location || 'unspecified';
    acc[key] = (acc[key] || 0) + price;
    return acc;
  }, {});

  res.json({
    totalUnits: inventory.length,
    byCondition,
    averagePrice,
    totalFeatured,
    averageDaysOnLot,
    valueByCondition,
    valueByLocation
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
  logActivity('create', 'team', `Created team ${team.name}`, { id: team.id });
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
  logActivity('update', 'team', `Updated team ${teams[index].name}`, { id: teams[index].id });
  res.json(teams[index]);
});

app.delete('/teams/:id', (req, res) => {
  const index = teams.findIndex(t => t.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Team');
  }
  const removed = teams.splice(index, 1);
  saveData('teams.json', teams);
  logActivity('delete', 'team', `Deleted team ${removed[0].name}`, { id: removed[0].id });
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
  logActivity('create', 'review', `New review from ${review.name}`, { id: review.id });
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
  logActivity('update', 'review', `Updated review from ${reviews[index].name}`, {
    id: reviews[index].id
  });
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
  logActivity('update', 'review', `Visibility toggled for ${reviews[index].name}`, {
    id: reviews[index].id
  });
  res.json(reviews[index]);
});

app.delete('/reviews/:id', (req, res) => {
  const index = reviews.findIndex(r => r.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Review');
  }
  const removed = reviews.splice(index, 1);
  saveData('reviews.json', reviews);
  logActivity('delete', 'review', `Deleted review from ${removed[0].name}`, { id: removed[0].id });
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
  logActivity('create', 'lead', `New lead: ${lead.name}`, { id: lead.id, status: lead.status });
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
  logActivity('update', 'lead', `Updated lead ${leads[index].name}`, { id: leads[index].id });
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
  logActivity('update', 'lead', `Lead ${leads[index].name} set to ${req.body.status}`, {
    id: leads[index].id,
    status: req.body.status
  });
  res.json(leads[index]);
});

app.delete('/leads/:id', (req, res) => {
  const index = leads.findIndex(l => l.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Lead');
  }
  const removed = leads.splice(index, 1);
  saveData('leads.json', leads);
  logActivity('delete', 'lead', `Deleted lead ${removed[0].name}`, { id: removed[0].id });
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
  TASK ROUTES
  Operational tasks with status, priority, owner and due date.
*/
app.get('/tasks', (req, res) => {
  const { status, priority, sortBy = 'dueDate', sortDir = 'asc' } = req.query;
  const filtered = tasks
    .filter(task => (status ? task.status === status : true))
    .filter(task => (priority ? task.priority === priority : true));

  const sorted = pickSort(filtered, sortBy, sortDir, {
    dueDate: (a, b) => new Date(a.dueDate || 0) - new Date(b.dueDate || 0),
    priority: (a, b) => VALID_PRIORITIES.indexOf(a.priority) - VALID_PRIORITIES.indexOf(b.priority)
  });

  res.json(sorted);
});

app.post('/tasks', (req, res) => {
  const requiredError = validateFields(req.body, ['title']);
  if (requiredError) {
    return res.status(400).json({ message: requiredError });
  }

  const status = VALID_TASK_STATUSES.includes(req.body.status) ? req.body.status : 'todo';
  const priority = VALID_PRIORITIES.includes(req.body.priority) ? req.body.priority : 'medium';

  const task = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    status,
    priority,
    ...req.body
  };

  tasks.push(task);
  saveData('tasks.json', tasks);
  logActivity('create', 'task', `New task: ${task.title}`, { id: task.id, status });
  res.status(201).json(task);
});

app.put('/tasks/:id', (req, res) => {
  const index = tasks.findIndex(task => task.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Task');
  }

  const status = req.body.status && VALID_TASK_STATUSES.includes(req.body.status)
    ? req.body.status
    : tasks[index].status;
  const priority = req.body.priority && VALID_PRIORITIES.includes(req.body.priority)
    ? req.body.priority
    : tasks[index].priority;

  tasks[index] = { ...tasks[index], ...req.body, status, priority };
  saveData('tasks.json', tasks);
  logActivity('update', 'task', `Updated task: ${tasks[index].title}`, { id: tasks[index].id });
  res.json(tasks[index]);
});

app.patch('/tasks/:id/status', (req, res) => {
  const index = tasks.findIndex(task => task.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Task');
  }

  if (!VALID_TASK_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ message: `Status must be one of: ${VALID_TASK_STATUSES.join(', ')}` });
  }

  tasks[index] = { ...tasks[index], status: req.body.status };
  saveData('tasks.json', tasks);
  logActivity('update', 'task', `Task ${tasks[index].title} set to ${req.body.status}`, {
    id: tasks[index].id,
    status: req.body.status
  });
  res.json(tasks[index]);
});

app.delete('/tasks/:id', (req, res) => {
  const index = tasks.findIndex(task => task.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Task');
  }
  const removed = tasks.splice(index, 1);
  saveData('tasks.json', tasks);
  logActivity('delete', 'task', `Deleted task ${removed[0].title}`, { id: removed[0].id });
  res.json(removed[0]);
});

/*
  APPOINTMENT ROUTES
  Scheduled events for sales, service, deliveries or virtual meetings.
*/
const VALID_APPOINTMENT_STATUSES = ['scheduled', 'completed', 'canceled'];

app.get('/appointments', (req, res) => {
  const { type, status, sortBy = 'scheduledFor', sortDir = 'asc' } = req.query;
  const filtered = appointments
    .filter(appt => (type ? appt.type === type : true))
    .filter(appt => (status ? appt.status === status : true));

  const sorted = pickSort(filtered, sortBy, sortDir, {
    scheduledFor: (a, b) => new Date(a.scheduledFor || 0) - new Date(b.scheduledFor || 0),
    customerName: (a, b) => (a.customerName || '').localeCompare(b.customerName || '')
  });

  res.json(sorted);
});

app.post('/appointments', (req, res) => {
  const requiredError = validateFields(req.body, ['customerName', 'scheduledFor']);
  if (requiredError) {
    return res.status(400).json({ message: requiredError });
  }

  const type = VALID_APPOINTMENT_TYPES.includes(req.body.type) ? req.body.type : 'sales';
  const status = VALID_APPOINTMENT_STATUSES.includes(req.body.status) ? req.body.status : 'scheduled';

  const appointment = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    type,
    status,
    ...req.body
  };

  appointments.push(appointment);
  saveData('appointments.json', appointments);
  logActivity('create', 'appointment', `Appointment for ${appointment.customerName}`, {
    id: appointment.id,
    status
  });
  res.status(201).json(appointment);
});

app.put('/appointments/:id', (req, res) => {
  const index = appointments.findIndex(appt => appt.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Appointment');
  }

  const type = req.body.type && VALID_APPOINTMENT_TYPES.includes(req.body.type)
    ? req.body.type
    : appointments[index].type;
  const status = req.body.status && VALID_APPOINTMENT_STATUSES.includes(req.body.status)
    ? req.body.status
    : appointments[index].status;

  appointments[index] = { ...appointments[index], ...req.body, type, status };
  saveData('appointments.json', appointments);
  logActivity('update', 'appointment', `Updated appointment for ${appointments[index].customerName}`, {
    id: appointments[index].id,
    status
  });
  res.json(appointments[index]);
});

app.patch('/appointments/:id/status', (req, res) => {
  const index = appointments.findIndex(appt => appt.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Appointment');
  }

  if (!VALID_APPOINTMENT_STATUSES.includes(req.body.status)) {
    return res
      .status(400)
      .json({ message: `Status must be one of: ${VALID_APPOINTMENT_STATUSES.join(', ')}` });
  }

  appointments[index] = { ...appointments[index], status: req.body.status };
  saveData('appointments.json', appointments);
  logActivity('update', 'appointment', `Appointment ${appointments[index].customerName} set to ${req.body.status}`, {
    id: appointments[index].id,
    status: req.body.status
  });
  res.json(appointments[index]);
});

app.delete('/appointments/:id', (req, res) => {
  const index = appointments.findIndex(appt => appt.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Appointment');
  }
  const removed = appointments.splice(index, 1);
  saveData('appointments.json', appointments);
  logActivity('delete', 'appointment', `Deleted appointment for ${removed[0].customerName}`, {
    id: removed[0].id
  });
  res.json(removed[0]);
});

/*
  ANNOUNCEMENT ROUTES
  Quick bulletins to broadcast across the dashboard.
*/
const VALID_ANNOUNCEMENT_SEVERITIES = ['info', 'warning', 'critical'];

app.get('/announcements', (req, res) => {
  const { active } = req.query;
  const filtered =
    active === undefined
      ? announcements
      : announcements.filter(ann => sanitizeBoolean(active) === sanitizeBoolean(ann.active, true));
  res.json(filtered);
});

app.post('/announcements', (req, res) => {
  const requiredError = validateFields(req.body, ['title', 'message']);
  if (requiredError) {
    return res.status(400).json({ message: requiredError });
  }

  const announcement = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    severity: VALID_ANNOUNCEMENT_SEVERITIES.includes(req.body.severity)
      ? req.body.severity
      : 'info',
    active: sanitizeBoolean(req.body.active, true),
    ...req.body
  };

  announcements.unshift(announcement);
  announcements = announcements.slice(0, 100);
  saveData('announcements.json', announcements);
  logActivity('create', 'announcement', `Announcement: ${announcement.title}`, { id: announcement.id });
  res.status(201).json(announcement);
});

app.patch('/announcements/:id', (req, res) => {
  const index = announcements.findIndex(ann => ann.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Announcement');
  }

  const severity = req.body.severity && VALID_ANNOUNCEMENT_SEVERITIES.includes(req.body.severity)
    ? req.body.severity
    : announcements[index].severity;

  announcements[index] = {
    ...announcements[index],
    ...req.body,
    severity,
    active: sanitizeBoolean(req.body.active, announcements[index].active)
  };
  saveData('announcements.json', announcements);
  logActivity('update', 'announcement', `Updated announcement ${announcements[index].title}`, {
    id: announcements[index].id
  });
  res.json(announcements[index]);
});

app.delete('/announcements/:id', (req, res) => {
  const index = announcements.findIndex(ann => ann.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Announcement');
  }
  const removed = announcements.splice(index, 1);
  saveData('announcements.json', announcements);
  logActivity('delete', 'announcement', `Deleted announcement ${removed[0].title}`, {
    id: removed[0].id
  });
  res.json(removed[0]);
});

/*
  CONTENT ROUTES
  Lightweight CMS for pages and FAQs used across the site and marketing stack.
*/
app.get('/pages', (req, res) => {
  const { status, search } = req.query;
  const filtered = pages
    .filter(page => (status ? page.status === status : true))
    .filter(page =>
      search
        ? `${page.title} ${page.slug} ${page.excerpt || ''}`
            .toLowerCase()
            .includes(search.toLowerCase())
        : true
    );
  res.json(filtered);
});

app.get('/pages/:slug', (req, res) => {
  const page = pages.find(p => p.slug === req.params.slug);
  if (!page) {
    return respondNotFound(res, 'Page');
  }
  res.json(page);
});

app.post('/pages', (req, res) => {
  const requiredError = validateFields(req.body, ['title', 'content']);
  if (requiredError) {
    return res.status(400).json({ message: requiredError });
  }

  const slug = toSlug(req.body.slug || req.body.title);
  const slugExists = pages.some(page => page.slug === slug);
  if (slugExists) {
    return res.status(400).json({ message: 'Slug already exists' });
  }

  const status = VALID_PAGE_STATUSES.includes(req.body.status) ? req.body.status : 'draft';
  const page = {
    id: uuidv4(),
    slug,
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    seo: { ...settings.seo, ...(req.body.seo || {}) },
    ...req.body
  };

  pages.push(page);
  saveData('pages.json', pages);
  logActivity('create', 'page', `Created page ${page.title}`, { slug: page.slug });
  res.status(201).json(page);
});

app.put('/pages/:id', (req, res) => {
  const index = pages.findIndex(page => page.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Page');
  }

  const slug = toSlug(req.body.slug || pages[index].slug || pages[index].title);
  const slugConflict = pages.some(page => page.slug === slug && page.id !== req.params.id);
  if (slugConflict) {
    return res.status(400).json({ message: 'Slug already exists for another page' });
  }

  const status = req.body.status && VALID_PAGE_STATUSES.includes(req.body.status)
    ? req.body.status
    : pages[index].status;

  pages[index] = {
    ...pages[index],
    ...req.body,
    slug,
    status,
    updatedAt: new Date().toISOString(),
    seo: { ...pages[index].seo, ...(req.body.seo || {}) }
  };

  saveData('pages.json', pages);
  logActivity('update', 'page', `Updated page ${pages[index].title}`, { slug: pages[index].slug });
  res.json(pages[index]);
});

app.patch('/pages/:id/status', (req, res) => {
  const index = pages.findIndex(page => page.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Page');
  }
  if (!VALID_PAGE_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ message: `Status must be one of: ${VALID_PAGE_STATUSES.join(', ')}` });
  }
  pages[index] = { ...pages[index], status: req.body.status, updatedAt: new Date().toISOString() };
  saveData('pages.json', pages);
  logActivity('update', 'page', `Page ${pages[index].title} marked ${req.body.status}`, {
    slug: pages[index].slug
  });
  res.json(pages[index]);
});

app.get('/faqs', (req, res) => {
  res.json(faqs);
});

app.post('/faqs', (req, res) => {
  const requiredError = validateFields(req.body, ['question', 'answer']);
  if (requiredError) {
    return res.status(400).json({ message: requiredError });
  }
  const faq = { id: uuidv4(), createdAt: new Date().toISOString(), ...req.body };
  faqs.push(faq);
  saveData('faqs.json', faqs);
  logActivity('create', 'faq', `Added FAQ: ${faq.question}`);
  res.status(201).json(faq);
});

app.put('/faqs/:id', (req, res) => {
  const index = faqs.findIndex(faq => faq.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'FAQ');
  }
  faqs[index] = { ...faqs[index], ...req.body };
  saveData('faqs.json', faqs);
  logActivity('update', 'faq', `Updated FAQ ${faqs[index].question}`);
  res.json(faqs[index]);
});

app.delete('/faqs/:id', (req, res) => {
  const index = faqs.findIndex(faq => faq.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'FAQ');
  }
  const removed = faqs.splice(index, 1);
  saveData('faqs.json', faqs);
  logActivity('delete', 'faq', `Removed FAQ ${removed[0].question}`);
  res.json(removed[0]);
});

/*
  AUTOMATION & INTEGRATION ROUTES
  Power users can orchestrate automations, webhooks, and third-party integrations.
*/
app.get('/webhooks', (req, res) => {
  res.json(webhooks);
});

app.post('/webhooks', (req, res) => {
  const requiredError = validateFields(req.body, ['name', 'url']);
  if (requiredError) {
    return res.status(400).json({ message: requiredError });
  }
  const topics = Array.isArray(req.body.topics) ? req.body.topics : VALID_WEBHOOK_TOPICS;
  const invalidTopics = topics.filter(topic => !VALID_WEBHOOK_TOPICS.includes(topic));
  if (invalidTopics.length) {
    return res.status(400).json({ message: `Invalid topics: ${invalidTopics.join(', ')}` });
  }

  const hook = {
    id: uuidv4(),
    enabled: true,
    createdAt: new Date().toISOString(),
    lastStatus: null,
    lastSentAt: null,
    topics,
    ...req.body
  };

  webhooks = uniqueById([...webhooks, hook]);
  saveData('webhooks.json', webhooks);
  logActivity('create', 'webhook', `Webhook ${hook.name} registered`, { id: hook.id });
  res.status(201).json(hook);
});

app.put('/webhooks/:id', (req, res) => {
  const index = webhooks.findIndex(hook => hook.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Webhook');
  }
  const topics = req.body.topics
    ? req.body.topics.filter(topic => VALID_WEBHOOK_TOPICS.includes(topic))
    : webhooks[index].topics;
  webhooks[index] = { ...webhooks[index], ...req.body, topics };
  saveData('webhooks.json', webhooks);
  logActivity('update', 'webhook', `Webhook ${webhooks[index].name} updated`, { id: webhooks[index].id });
  res.json(webhooks[index]);
});

app.patch('/webhooks/:id/toggle', (req, res) => {
  const index = webhooks.findIndex(hook => hook.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Webhook');
  }
  const enabled = sanitizeBoolean(req.body.enabled, !webhooks[index].enabled);
  webhooks[index] = { ...webhooks[index], enabled };
  saveData('webhooks.json', webhooks);
  logActivity('update', 'webhook', `Webhook ${webhooks[index].name} ${enabled ? 'enabled' : 'disabled'}`);
  res.json(webhooks[index]);
});

app.post('/webhooks/:id/test', (req, res) => {
  const index = webhooks.findIndex(hook => hook.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Webhook');
  }
  webhooks[index] = {
    ...webhooks[index],
    lastStatus: 200,
    lastSentAt: new Date().toISOString(),
    lastPayload: req.body.payload || { ping: true }
  };
  saveData('webhooks.json', webhooks);
  logActivity('update', 'webhook', `Webhook ${webhooks[index].name} test fired`);
  res.json(webhooks[index]);
});

app.get('/automations', (req, res) => {
  const { status } = req.query;
  const filtered = automations.filter(rule => (status ? rule.status === status : true));
  res.json(filtered);
});

app.post('/automations', (req, res) => {
  const requiredError = validateFields(req.body, ['name', 'trigger']);
  if (requiredError) {
    return res.status(400).json({ message: requiredError });
  }
  const status = VALID_AUTOMATION_STATUSES.includes(req.body.status) ? req.body.status : 'active';
  const rule = {
    id: uuidv4(),
    status,
    runCount: 0,
    createdAt: new Date().toISOString(),
    ...req.body
  };
  automations.push(rule);
  saveData('automations.json', automations);
  logActivity('create', 'automation', `Automation ${rule.name} created`, { id: rule.id });
  res.status(201).json(rule);
});

app.put('/automations/:id', (req, res) => {
  const index = automations.findIndex(rule => rule.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Automation');
  }
  const status = req.body.status && VALID_AUTOMATION_STATUSES.includes(req.body.status)
    ? req.body.status
    : automations[index].status;
  automations[index] = { ...automations[index], ...req.body, status };
  saveData('automations.json', automations);
  logActivity('update', 'automation', `Automation ${automations[index].name} updated`);
  res.json(automations[index]);
});

app.patch('/automations/:id/status', (req, res) => {
  const index = automations.findIndex(rule => rule.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Automation');
  }
  if (!VALID_AUTOMATION_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ message: `Status must be one of: ${VALID_AUTOMATION_STATUSES.join(', ')}` });
  }
  automations[index] = { ...automations[index], status: req.body.status };
  saveData('automations.json', automations);
  logActivity('update', 'automation', `Automation ${automations[index].name} ${req.body.status}`);
  res.json(automations[index]);
});

app.post('/automations/:id/run', (req, res) => {
  const index = automations.findIndex(rule => rule.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Automation');
  }
  const rule = automations[index];
  automations[index] = {
    ...rule,
    lastRunAt: new Date().toISOString(),
    runCount: (rule.runCount || 0) + 1
  };
  saveData('automations.json', automations);

  if (Array.isArray(rule.actions)) {
    rule.actions.forEach(action => {
      if (action.type === 'create_task') {
        const task = {
          id: uuidv4(),
          createdAt: new Date().toISOString(),
          title: action.title || `Automation: ${rule.name}`,
          status: 'todo',
          priority: action.priority || 'medium'
        };
        tasks.push(task);
        saveData('tasks.json', tasks);
        logActivity('create', 'task', `Automation created task ${task.title}`, { automationId: rule.id });
      }
    });
  }

  logActivity('update', 'automation', `Automation ${rule.name} executed`, { id: rule.id });
  res.json(automations[index]);
});

app.get('/integrations', (req, res) => {
  res.json(integrations);
});

app.put('/integrations/:id', (req, res) => {
  const index = integrations.findIndex(integration => integration.id === req.params.id);
  if (index === -1) {
    return respondNotFound(res, 'Integration');
  }
  integrations[index] = {
    ...integrations[index],
    ...req.body,
    lastSyncAt: req.body.status === 'connected' ? new Date().toISOString() : integrations[index].lastSyncAt
  };
  saveData('integrations.json', integrations);
  logActivity('update', 'integration', `Integration ${integrations[index].name} updated`);
  res.json(integrations[index]);
});

/*
  REPORTING & EXPORT ROUTES
  Operational intelligence via lightweight aggregates and CSV exports.
*/
app.get('/reports/overview', (req, res) => {
  const leadTotals = leads.reduce(
    (acc, lead) => ({
      ...acc,
      [lead.status || 'unknown']: (acc[lead.status || 'unknown'] || 0) + 1
    }),
    {}
  );
  const wonLeads = leadTotals.won || 0;
  const conversionRate = leads.length ? Number(((wonLeads / leads.length) * 100).toFixed(1)) : 0;

  const averageLeadValue = leads.length
    ? leads.reduce((sum, lead) => sum + Number(lead.estimatedValue || 0), 0) / leads.length
    : 0;
  const taskAgingHours = tasks
    .filter(task => task.createdAt)
    .map(task => (Date.now() - new Date(task.createdAt)) / (1000 * 60 * 60));
  const avgTaskAgeHours = taskAgingHours.length
    ? Number((taskAgingHours.reduce((a, b) => a + b, 0) / taskAgingHours.length).toFixed(1))
    : 0;

  const topLocations = inventory.reduce((acc, unit) => {
    const key = unit.location || 'unspecified';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  res.json({
    leadTotals,
    conversionRate,
    averageLeadValue,
    avgTaskAgeHours,
    topLocations,
    revenueFootprint: inventory.reduce((sum, unit) => sum + Number(unit.price || 0), 0)
  });
});

app.get('/exports/:resource', (req, res) => {
  const resource = req.params.resource;
  const map = {
    inventory: inventory.map(unit => ({
      id: unit.id,
      stockNumber: unit.stockNumber,
      name: unit.name,
      price: unit.price,
      location: unit.location,
      condition: unit.condition
    })),
    leads: leads.map(lead => ({
      id: lead.id,
      name: lead.name,
      status: lead.status,
      email: lead.email,
      source: lead.source
    })),
    tasks: tasks.map(task => ({
      id: task.id,
      title: task.title,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate
    }))
  };

  if (!map[resource]) {
    return res.status(400).json({ message: 'Unsupported export type' });
  }

  const rows = map[resource];
  const headers = Object.keys(rows[0] || {});
  const csv = [headers.join(',')]
    .concat(rows.map(row => headers.map(header => JSON.stringify(row[header] ?? '')).join(',')))
    .join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${resource}.csv`);
  res.send(csv);
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
  logActivity('update', 'settings', 'Settings updated', { updatedBy: req.body.updatedBy });
  res.json(settings);
});

// Basic root route with description
app.get('/', (req, res) => {
  const resources = [
    '/inventory',
    '/teams',
    '/reviews',
    '/leads',
    '/tasks',
    '/appointments',
    '/announcements',
    '/pages',
    '/faqs',
    '/webhooks',
    '/automations',
    '/integrations',
    '/reports',
    '/exports',
    '/settings',
    '/dashboard'
  ];

  res.json({
    message: `RV Dealer Backend API is running. Available resources: ${resources.join(', ')}`
  });
});

app.listen(port, () => {
  console.log(`Backend server listening on port ${port}`);
});