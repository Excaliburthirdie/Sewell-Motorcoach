const tenantId = new URLSearchParams(window.location.search).get('tenantId') || 'main';
const headers = { 'X-Tenant-Id': tenantId };

const formatCurrency = value =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value || 0);

function createKpiCard(title, value, subtext, tone = 'neutral') {
  const div = document.createElement('div');
  div.className = 'kpi';
  div.innerHTML = `
    <p class="eyebrow">${title}</p>
    <div class="value">${value}</div>
    <p class="subtext">${subtext}</p>
    <span class="pill ${tone === 'success' ? 'success' : 'accent'}">${tone === 'success' ? 'Green' : 'Pulse'}</span>
  `;
  return div;
}

function renderKpis(metrics, inventoryStats, rollupSummary) {
  const kpiList = document.getElementById('kpi-list');
  kpiList.innerHTML = '';
  const { counts = {} } = metrics || {};
  const { leadsToday = 0, eventsToday = 0, reviewsRecent = 0 } = rollupSummary || {};
  const kpis = [
    {
      title: 'Inventory Depth',
      value: counts.inventory ?? '—',
      subtext: 'Total units across the network',
      tone: 'accent'
    },
    {
      title: 'Lead Velocity',
      value: `${leadsToday}/day`,
      subtext: 'Daily captured opportunities',
      tone: 'success'
    },
    {
      title: 'Engagement Signals',
      value: `${eventsToday} events`,
      subtext: 'Searches, views, and hand-raisers',
      tone: 'accent'
    },
    {
      title: 'Guest Delight',
      value: `${reviewsRecent} reviews`,
      subtext: 'Fresh feedback in the last 24h',
      tone: 'success'
    },
    {
      title: 'Average Price',
      value: formatCurrency(inventoryStats?.averagePrice || 0),
      subtext: 'Mean ticket for current stock',
      tone: 'success'
    }
  ];

  kpis.forEach(kpi => kpiList.appendChild(createKpiCard(kpi.title, kpi.value, kpi.subtext, kpi.tone)));
}

function renderInventoryTable(items = []) {
  const container = document.getElementById('inventory-table');
  const header = document.createElement('div');
  header.className = 'table-row table-head';
  header.innerHTML = '<span>Stock</span><span>Model</span><span>Condition</span><span class="align-right">Price</span>';
  container.innerHTML = '';
  container.appendChild(header);

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'table-row';
    empty.innerHTML = '<span>No units yet</span><span></span><span></span><span></span>';
    container.appendChild(empty);
    return;
  }

  items.slice(0, 6).forEach(unit => {
    const row = document.createElement('div');
    row.className = 'table-row';
    row.innerHTML = `
      <span>${unit.stockNumber || '—'}</span>
      <span>${unit.name || unit.model || 'Untitled model'}</span>
      <span>${unit.condition || 'N/A'}</span>
      <span class="align-right">${formatCurrency(unit.totalPrice || unit.price || 0)}</span>
    `;
    container.appendChild(row);
  });
}

function renderConditionChart(byCondition = {}) {
  const chart = document.getElementById('condition-chart');
  const legend = document.getElementById('chart-legend');
  chart.innerHTML = '';
  legend.innerHTML = '';

  const entries = Object.entries(byCondition);
  if (!entries.length) {
    chart.innerHTML = '<p style="color: var(--muted);">No inventory data yet.</p>';
    return;
  }

  const maxValue = Math.max(...entries.map(([, value]) => value));
  const swatches = ['#7ddaff', '#c8a6ff', '#6db0ff', '#4dd299'];

  entries.forEach(([condition, count], index) => {
    const height = maxValue ? (count / maxValue) * 100 : 0;
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = `${height}%`;
    bar.style.background = `linear-gradient(180deg, ${swatches[index % swatches.length]}, #17203f)`;
    bar.innerHTML = `<span>${count}</span>`;
    chart.appendChild(bar);

    const legendItem = document.createElement('div');
    legendItem.className = 'legend-item';
    legendItem.innerHTML = `<span class="legend-swatch" style="background:${swatches[index % swatches.length]};"></span>${condition}`;
    legend.appendChild(legendItem);
  });
}

function renderActivityFeed(reviews = [], inventory = [], rollupSummary = {}) {
  const feed = document.getElementById('activity-feed');
  feed.innerHTML = '';

  const activities = [
    {
      title: `${rollupSummary.leadsToday || 0} leads captured today`,
      time: new Date().toISOString(),
      accent: 'Leads'
    },
    {
      title: `${rollupSummary.eventsToday || 0} shopper events recorded`,
      time: new Date().toISOString(),
      accent: 'Events'
    },
    ...reviews.slice(0, 3).map(review => ({
      title: `${review.author || 'Guest'} rated ${review.rating || 5}/5`,
      time: review.createdAt || 'recent',
      accent: 'Review'
    })),
    ...inventory.slice(0, 2).map(unit => ({
      title: `${unit.name || unit.model || 'Unit'} • ${unit.condition || 'condition unknown'}`,
      time: unit.createdAt || 'recent',
      accent: 'Inventory'
    }))
  ];

  if (!activities.length) {
    feed.innerHTML = '<p style="color: var(--muted);">Waiting for signals...</p>';
    return;
  }

  activities.forEach(item => {
    const row = document.createElement('div');
    row.className = 'activity-item';
    row.innerHTML = `
      <div>
        <strong>${item.title}</strong>
        <small>${new Date(item.time).toLocaleString()}</small>
      </div>
      <span class="pill accent">${item.accent}</span>
    `;
    feed.appendChild(row);
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error('Request failed');
  return response.json();
}

async function loadDashboard() {
  document.getElementById('live-tenants').textContent = tenantId;
  document.title = `Sewell Motorcoach | ${tenantId} Dashboard`;
  const today = new Date().toISOString().slice(0, 10);

  const [metricsRes, statsRes, inventoryRes, reviewsRes] = await Promise.allSettled([
    fetchJson('/v1/metrics'),
    fetchJson('/v1/inventory/stats'),
    fetchJson('/v1/inventory?featured=true&limit=6'),
    fetchJson('/v1/reviews?limit=5')
  ]);

  const metrics = metricsRes.value || { counts: {}, rollup: {} };
  const stats = statsRes.value || { averagePrice: 0, byCondition: {} };
  const inventory = inventoryRes.value || { items: [] };
  const reviews = reviewsRes.value || { items: [] };

  const eventsToday = metrics.rollup?.events?.[today]?.total || 0;
  const leadsToday = metrics.rollup?.leads?.[today]?.total || 0;
  const rollupSummary = {
    eventsToday,
    leadsToday,
    reviewsRecent: (reviews.items || reviews).length || 0
  };

  renderKpis(metrics, stats, rollupSummary);
  renderConditionChart(stats.byCondition || {});
  document.getElementById('avg-price').textContent = formatCurrency(stats.averagePrice || 0);
  renderInventoryTable(inventory.items || inventory || []);
  renderActivityFeed(reviews.items || reviews || [], inventory.items || inventory || [], rollupSummary);
}

document.getElementById('refresh-inventory').addEventListener('click', loadDashboard);
loadDashboard();
