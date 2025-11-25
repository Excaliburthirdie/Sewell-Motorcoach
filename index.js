const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(cors());

// Helper functions for reading/writing JSON data. If the file does not
// exist or contains invalid JSON, an empty array/object is returned.
function loadData(file, defaultValue) {
  try {
    const data = fs.readFileSync(`${__dirname}/data/${file}`, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return defaultValue;
  }
}

function saveData(file, data) {
  fs.writeFileSync(`${__dirname}/data/${file}`, JSON.stringify(data, null, 2));
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
  phone: '859-734-5566'
});

/*
  INVENTORY ROUTES
  Endpoints for managing RV inventory units.
  Each unit has an id, stockNumber, industry, category, subcategory,
  condition (e.g. New, Used), msrp, price, salePrice, location,
  daysOnLot, images array and featured boolean.
*/
app.get('/inventory', (req, res) => {
  res.json(inventory);
});

app.get('/inventory/:id', (req, res) => {
  const unit = inventory.find(u => u.id === req.params.id);
  if (!unit) {
    return res.status(404).json({ message: 'Unit not found' });
  }
  res.json(unit);
});

app.post('/inventory', (req, res) => {
  const unit = { id: uuidv4(), ...req.body };
  inventory.push(unit);
  saveData('inventory.json', inventory);
  res.status(201).json(unit);
});

app.put('/inventory/:id', (req, res) => {
  const index = inventory.findIndex(u => u.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Unit not found' });
  }
  inventory[index] = { ...inventory[index], ...req.body };
  saveData('inventory.json', inventory);
  res.json(inventory[index]);
});

app.delete('/inventory/:id', (req, res) => {
  const index = inventory.findIndex(u => u.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Unit not found' });
  }
  const removed = inventory.splice(index, 1);
  saveData('inventory.json', inventory);
  res.json(removed[0]);
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
  const team = { id: uuidv4(), ...req.body };
  teams.push(team);
  saveData('teams.json', teams);
  res.status(201).json(team);
});

app.put('/teams/:id', (req, res) => {
  const index = teams.findIndex(t => t.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Team not found' });
  }
  teams[index] = { ...teams[index], ...req.body };
  saveData('teams.json', teams);
  res.json(teams[index]);
});

app.delete('/teams/:id', (req, res) => {
  const index = teams.findIndex(t => t.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Team not found' });
  }
  const removed = teams.splice(index, 1);
  saveData('teams.json', teams);
  res.json(removed[0]);
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
  const review = { id: uuidv4(), visible: true, ...req.body };
  reviews.push(review);
  saveData('reviews.json', reviews);
  res.status(201).json(review);
});

app.put('/reviews/:id', (req, res) => {
  const index = reviews.findIndex(r => r.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Review not found' });
  }
  reviews[index] = { ...reviews[index], ...req.body };
  saveData('reviews.json', reviews);
  res.json(reviews[index]);
});

app.delete('/reviews/:id', (req, res) => {
  const index = reviews.findIndex(r => r.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Review not found' });
  }
  const removed = reviews.splice(index, 1);
  saveData('reviews.json', reviews);
  res.json(removed[0]);
});

/*
  LEAD ROUTES
  Leads represent submissions from contact forms. Each lead has id,
  name, email, subject, message and createdAt timestamp.
*/
app.get('/leads', (req, res) => {
  res.json(leads);
});

app.get('/leads/:id', (req, res) => {
  const lead = leads.find(l => l.id === req.params.id);
  if (!lead) {
    return res.status(404).json({ message: 'Lead not found' });
  }
  res.json(lead);
});

app.post('/leads', (req, res) => {
  const lead = { id: uuidv4(), createdAt: new Date().toISOString(), ...req.body };
  leads.push(lead);
  saveData('leads.json', leads);
  res.status(201).json(lead);
});

app.put('/leads/:id', (req, res) => {
  const index = leads.findIndex(l => l.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Lead not found' });
  }
  leads[index] = { ...leads[index], ...req.body };
  saveData('leads.json', leads);
  res.json(leads[index]);
});

app.delete('/leads/:id', (req, res) => {
  const index = leads.findIndex(l => l.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ message: 'Lead not found' });
  }
  const removed = leads.splice(index, 1);
  saveData('leads.json', leads);
  res.json(removed[0]);
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
  settings = { ...settings, ...req.body };
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