const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { escapeOutputPayload, sanitizePayloadStrings } = require('./shared');
const { normalizeTenantId, matchesTenant, attachTenant, getHomeLocation } = require('./tenantService');
const inventoryService = require('./inventoryService');
const leadService = require('./leadService');
const contentPageService = require('./contentPageService');
const seoService = require('./seoService');

function safe(value) {
  return escapeOutputPayload(value);
}

function ensureShape() {
  datasets.insights = datasets.insights || {};
  datasets.insights.objectionLibrary = datasets.insights.objectionLibrary || [];
  datasets.insights.proposalSummaries = datasets.insights.proposalSummaries || [];
}

function seedObjections(tenantId) {
  ensureShape();
  const tenant = normalizeTenantId(tenantId);
  const hasSeed = datasets.insights.objectionLibrary.some(entry => matchesTenant(entry.tenantId, tenant));
  if (hasSeed) return;
  const seeded = [
    {
      id: randomUUID(),
      tenantId: tenant,
      question: 'Can I tow this with my F-150?',
      answer:
        'Yes, several of our lightweight bunkhouse and couples coaches are half-ton friendly. We confirm payload, hitch, and GCWR before recommending a match.',
      tags: ['towing', 'truck-compatibility'],
      links: ['/content/towing-guide']
    },
    {
      id: randomUUID(),
      tenantId: tenant,
      question: 'How is this in winter?',
      answer:
        'Units with enclosed underbellies, dual-pane windows, and heat pads handle winter best. We walk you through winterizing and cold-weather camping tips.',
      tags: ['four-season', 'weather'],
      links: ['/content/winter-camping-checklist']
    },
    {
      id: randomUUID(),
      tenantId: tenant,
      question: 'What about warranty or service while traveling?',
      answer:
        'We enroll you with nationwide service partners and include phone-first diagnostics. Major OEM networks honor warranty at authorized shops.',
      tags: ['service', 'warranty'],
      links: ['/content/ownership-support']
    }
  ];
  datasets.insights.objectionLibrary.push(...seeded);
  persist.insights(datasets.insights);
}

function listObjections(query, tenantId, leadId) {
  const tenant = normalizeTenantId(tenantId);
  seedObjections(tenant);
  const search = (query || '').toLowerCase();
  const lead = leadId ? leadService.list({}, tenant).items?.find(item => item.id === leadId) : undefined;
  const matches = datasets.insights.objectionLibrary
    .filter(entry => matchesTenant(entry.tenantId, tenant))
    .filter(entry => {
      if (!search) return true;
      return (
        entry.question.toLowerCase().includes(search) ||
        entry.answer.toLowerCase().includes(search) ||
        (entry.tags || []).some(tag => tag.toLowerCase().includes(search))
      );
    })
    .map(entry => {
      if (!lead) return entry;
      const interestedStock = lead.interestedStockNumber || lead.interestedInventoryId;
      const relevanceBoost = interestedStock && (entry.tags || []).some(tag => String(tag).includes('towing')) ? 2 : 1;
      return { ...entry, relevance: relevanceBoost };
    })
    .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
    .map(safe);
  return { items: matches };
}

function addObjection(payload, tenantId) {
  ensureShape();
  const sanitized = sanitizePayloadStrings(payload, ['question', 'answer']);
  const entry = attachTenant(
    {
      id: randomUUID(),
      question: sanitized.question,
      answer: sanitized.answer,
      tags: payload.tags || [],
      links: payload.links || []
    },
    tenantId
  );
  datasets.insights.objectionLibrary.push(entry);
  persist.insights(datasets.insights);
  return { entry: safe(entry) };
}

function proposalSummary(leadId, tenantId, options = {}) {
  const tenant = normalizeTenantId(tenantId);
  const lead = leadId ? leadService.list({}, tenant).items?.find(item => item.id === leadId) : undefined;
  const inventory = inventoryService.list({}, tenant).items || [];
  const interestedStock = lead?.interestedStockNumber || lead?.interestedInventoryId;
  const unit = interestedStock
    ? inventory.find(item => item.id === interestedStock || item.stockNumber === interestedStock)
    : inventory.find(item => item.featured) || inventory[0];

  const summary = {
    leadId: lead?.id,
    leadName: lead?.name,
    headline: unit ? `${unit.year || ''} ${unit.name || unit.category || 'Unit'} Proposal` : 'Unit Proposal',
    unitSummary: unit
      ? {
          stockNumber: unit.stockNumber,
          title: unit.name || unit.category,
          location: unit.location,
          price: unit.salePrice || unit.price || unit.msrp,
          msrp: unit.msrp,
          condition: unit.condition,
          badges: unit.badges || [],
          storyHighlights: unit.story || unit.description || 'Ready for adventures with plenty of storage and comfort.'
        }
      : undefined,
    trade: lead?.tradeDetails || lead?.message,
    valueProps: [
      'Delivery-ready walkthrough and orientation included',
      'We handle titling, doc prep, and lender coordination',
      'Service concierge plus mobile tech referrals for your county'
    ],
    notes: lead?.notes || 'All finance numbers remain in the dealer’s F&I tools.'
  };

  const html = renderProposalHtml(summary);
  const pdfBase64 = options.format === 'pdf' ? renderProposalPdf(summary) : undefined;

  const stored = {
    id: randomUUID(),
    leadId: summary.leadId,
    tenantId: tenant,
    generatedAt: new Date().toISOString(),
    headline: summary.headline
  };
  datasets.insights.proposalSummaries.push(stored);
  persist.insights(datasets.insights);

  return {
    summary: safe(summary),
    document: {
      format: 'html',
      html,
      pdf: pdfBase64
        ? {
            filename: `${summary.headline.replace(/\s+/g, '-') || 'proposal'}.pdf`,
            mime: 'application/pdf',
            base64: pdfBase64
          }
        : undefined
    }
  };
}

function seoOpportunities(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const events = (datasets.analytics.events || []).filter(evt => matchesTenant(evt.tenantId, tenant));
  const searches = events.filter(evt => evt.type === 'search' || evt.resourceType === 'search');
  const inventory = inventoryService.list({}, tenant).items || [];

  const termCounts = searches.reduce((acc, evt) => {
    const term = (evt.metrics?.query || evt.note || '').toString().toLowerCase();
    if (!term) return acc;
    acc[term] = (acc[term] || 0) + (evt.metrics?.impressions || 1);
    return acc;
  }, {});

  const existingLandingPages = contentPageService
    .list({}, tenant)
    .map(page => page.slug || page.title || '')
    .filter(Boolean);

  const opportunities = Object.entries(termCounts)
    .map(([term, impressions]) => {
      const hasInventory = inventory.some(item =>
        `${item.name || ''} ${item.category || ''} ${item.subCategory || ''}`.toLowerCase().includes(term)
      );
      const hasPage = existingLandingPages.some(slug => slug.toLowerCase().includes(term));
      if (hasPage) return null;
      return {
        term,
        estimatedImpressions: impressions,
        inventoryMatch: hasInventory,
        suggestedSlug: `/landing/${term.replace(/\s+/g, '-')}`,
        rationale: hasInventory
          ? 'Inventory exists but there is no focused landing experience.'
          : 'Search demand present with no matching inventory — consider sourcing units.'
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.estimatedImpressions - a.estimatedImpressions)
    .slice(0, 25)
    .map(safe);

  return { opportunities };
}

function trendRadar(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const events = (datasets.analytics.events || []).filter(evt => matchesTenant(evt.tenantId, tenant));
  const interestCounters = new Map();

  const pushAttribute = (label, weight = 1) => {
    const current = interestCounters.get(label) || { count: 0 };
    interestCounters.set(label, { count: current.count + weight });
  };

  events.forEach(evt => {
    const filters = evt.metrics?.filters || [];
    filters.forEach(filter => pushAttribute(filter, 1));
    const features = evt.metrics?.features || [];
    features.forEach(feature => pushAttribute(feature, 2));
    if (evt.type === 'inventory_view' && evt.metrics?.floorplan) {
      pushAttribute(evt.metrics.floorplan, 3);
    }
  });

  const topAttributes = Array.from(interestCounters.entries())
    .map(([label, data]) => ({ label, score: data.count }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);

  return { attributes: safe(topAttributes) };
}

function contentRoi(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const pages = contentPageService.list({}, tenant) || [];
  const events = (datasets.analytics.events || []).filter(evt => matchesTenant(evt.tenantId, tenant));

  const byPage = pages.map(page => {
    const relatedEvents = events.filter(evt => evt.resourceType === 'content' && evt.resourceId === page.id);
    const views = relatedEvents.length;
    const timeOnPage = relatedEvents.reduce((acc, evt) => acc + (evt.metrics?.timeOnPage || 0), 0);
    const leads = datasets.leads.filter(lead => matchesTenant(lead.tenantId, tenant) && lead.sourcePageId === page.id);
    const hearts = relatedEvents.filter(evt => evt.type === 'favorite' || evt.metrics?.action === 'heart').length;
    const deals = relatedEvents.filter(evt => evt.type === 'deal' || evt.metrics?.status === 'won').length;
    const stage =
      deals > 0 || leads.length > 0
        ? 'decision'
        : hearts > 0 || timeOnPage > 180
          ? 'consideration'
          : 'awareness';
    return safe({
      pageId: page.id,
      title: page.title,
      views,
      avgTimeOnPage: views ? Math.round(timeOnPage / views) : 0,
      leads: leads.length,
      favorites: hearts,
      deals,
      label: stage
    });
  });

  return { pages: byPage };
}

function localDemand(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const leads = datasets.leads.filter(lead => matchesTenant(lead.tenantId, tenant));
  const events = (datasets.analytics.events || []).filter(evt => matchesTenant(evt.tenantId, tenant));
  const home = getHomeLocation(tenant);

  const heat = leads.reduce((acc, lead) => {
    const city = lead.city || lead.location || lead.region || 'Unknown';
    const coords = deriveCoordinates(lead);
    acc[city] = acc[city] || { leads: 0, won: 0, coords, distanceMiles: [] };
    acc[city].leads += 1;
    if (lead.status === 'won') acc[city].won += 1;
    const distance = computeDistanceMiles(lead, coords, home.coordinates);
    if (distance !== undefined) acc[city].distanceMiles.push(distance);
    return acc;
  }, {});

  const visitorHotspots = events
    .filter(evt => evt.type === 'inventory_view' || evt.type === 'lead')
    .reduce((acc, evt) => {
      const city = evt.metrics?.city || evt.region || 'Unknown';
      const coords = deriveCoordinates(evt.metrics || {});
      acc[city] = acc[city] || { visits: 0, coords, distanceMiles: [] };
      acc[city].visits += 1;
      const distance = computeDistanceMiles(evt, coords, home.coordinates);
      if (distance !== undefined) acc[city].distanceMiles.push(distance);
      return acc;
    }, {});

  const radiusBuckets = buildRadiusBuckets({ leads, events, homeCoordinates: home.coordinates });

  const points = Object.entries({ ...heat, ...visitorHotspots }).map(([city, data]) => ({
    city,
    leads: data.leads || 0,
    won: data.won || 0,
    visits: data.visits || 0,
    coordinates: data.coords,
    avgDistanceMiles:
      data.distanceMiles && data.distanceMiles.length
        ? Number((data.distanceMiles.reduce((a, b) => a + b, 0) / data.distanceMiles.length).toFixed(1))
        : undefined,
    conversionRate: (data.leads || data.visits) ? Math.round(((data.won || 0) / (data.leads || data.visits)) * 100) : 0
  }));

  return { points: safe(points), radius: safe(radiusBuckets), home: safe(home) };
}

function behaviorHeatmaps(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const events = (datasets.analytics.events || []).filter(evt => matchesTenant(evt.tenantId, tenant));
  const grouped = {};

  events
    .filter(evt => evt.type === 'scroll' || evt.type === 'click')
    .forEach(evt => {
      const pageType = evt.metrics?.pageType || evt.resourceType || 'unknown';
      grouped[pageType] = grouped[pageType] || { clicks: 0, scrollDepth: 0, samples: 0 };
      if (evt.type === 'click') grouped[pageType].clicks += 1;
      if (evt.type === 'scroll') grouped[pageType].scrollDepth += evt.metrics?.depth || 0;
      grouped[pageType].samples += 1;
    });

  const heatmaps = Object.entries(grouped).map(([pageType, stats]) => ({
    pageType,
    avgScrollDepth: stats.samples ? Math.round(stats.scrollDepth / stats.samples) : 0,
    clicks: stats.clicks,
    samples: stats.samples
  }));

  return { heatmaps: safe(heatmaps) };
}

function deepAttribution(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const leads = datasets.leads.filter(lead => matchesTenant(lead.tenantId, tenant));
  const campaigns = datasets.campaigns || [];
  const events = (datasets.analytics.events || []).filter(evt => matchesTenant(evt.tenantId, tenant));

  const paths = leads.map(lead => {
    const first = campaigns.find(c => c.id === lead.firstTouchCampaignId);
    const last = campaigns.find(c => c.id === lead.lastTouchCampaignId);
    const timeline = events
      .filter(evt => evt.metrics?.leadId === lead.id || evt.resourceId === lead.id || evt.metrics?.contactId === lead.contactId)
      .map(evt => ({
        label: evt.metrics?.label || evt.type || 'touch',
        channel: evt.metrics?.channel || evt.channel || 'unknown',
        campaign: evt.metrics?.campaign || evt.campaignId,
        timestamp: evt.timestamp || evt.createdAt || new Date().toISOString(),
        weight: evt.metrics?.weight || (evt.type === 'lead' ? 3 : 1)
      }))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const weightedContribution = timeline.reduce((acc, touch) => {
      const key = touch.channel || 'unknown';
      acc[key] = (acc[key] || 0) + touch.weight;
      return acc;
    }, {});

    return {
      leadId: lead.id,
      stages: [
        first ? { label: 'First touch', campaign: first.name, channel: first.channel } : null,
        ...timeline,
        last ? { label: 'Last touch', campaign: last.name, channel: last.channel } : null
      ].filter(Boolean),
      weightedContribution
    };
  });

  const channelContribution = paths.reduce((acc, path) => {
    Object.entries(path.weightedContribution || {}).forEach(([channel, weight]) => {
      acc[channel] = (acc[channel] || 0) + weight;
    });
    return acc;
  }, {});

  return { paths: safe(paths), channels: safe(channelContribution) };
}

function merchandisingScores(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const inventory = inventoryService.list({}, tenant).items || [];
  const seoProfiles = seoService.list({}, tenant);
  const leads = datasets.leads.filter(lead => matchesTenant(lead.tenantId, tenant));

  const scored = inventory.map(item => {
    let score = 40;
    if (item.images?.length > 5) score += 15;
    if (item.videoLinks?.length || item.virtualTours?.length) score += 10;
    if (item.badges?.length) score += 5;
    if (item.spotlights?.length) score += 5;
    if (item.story) score += 5;
    const profile = seoProfiles.find(profile => profile.resourceId === item.id && profile.resourceType === 'inventory');
    if (profile?.score) score += Math.min(20, Math.round(profile.score / 5));
    if (item.updatedAt && Date.now() - Date.parse(item.updatedAt) > 1000 * 60 * 60 * 24 * 45) score -= 5;
    const leadCount = leads.filter(lead => lead.interestedStockNumber === item.stockNumber || lead.interestedInventoryId === item.id)
      .length;
    if (leadCount > 2) score += 5;
    return {
      unitId: item.id,
      stockNumber: item.stockNumber,
      name: item.name,
      score: Math.max(0, Math.min(100, score)),
      actionItems: buildMerchandisingActions(item, profile)
    };
  });

  const storeRollup = scored.reduce((acc, entry) => acc + entry.score, 0) / (scored.length || 1);
  return { units: safe(scored), storeScore: Math.round(storeRollup || 0) };
}

function buildMerchandisingActions(item, profile) {
  const actions = [];
  if (!item.images || item.images.length < 6) actions.push('Add lifestyle photos');
  if (!item.story) actions.push('Write a sales story');
  if (!profile?.metaTitle) actions.push('Fix missing SEO title');
  if (!item.heroImage && (!item.images || !item.images.length)) actions.push('Update hero image');
  if (!item.videoLinks?.length && !item.virtualTours?.length) actions.push('Attach a walkthrough video');
  return actions;
}

function merchandisingQueue(tenantId) {
  const { units } = merchandisingScores(tenantId);
  const prioritized = units
    .filter(unit => unit.score < 80)
    .map(unit => ({
      ...unit,
      priority: 100 - unit.score,
      suggestedFixes: unit.actionItems
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 20);
  return { queue: safe(prioritized) };
}

function modelLifecycleInsights(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const inventory = inventoryService.list({}, tenant).items || [];
  const insights = inventory.map(item => {
    const ageDays = item.daysOnLot || (item.addedAt ? Math.round((Date.now() - Date.parse(item.addedAt)) / 86400000) : 0);
    const stage = ageDays < 30 ? 'new-arrival' : ageDays < 120 ? 'mid-life' : 'closeout';
    return safe({
      model: item.name,
      stockNumber: item.stockNumber,
      stage,
      ageDays,
      guidance:
        stage === 'new-arrival'
          ? 'Lead with story and premium imagery to capture early excitement.'
          : stage === 'mid-life'
            ? 'Run retargeting and emphasize value props to re-engage shoppers.'
            : 'Price-forward merchandising and clearance messaging recommended.'
    });
  });
  return { models: insights };
}

function frictionMap(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const events = (datasets.analytics.events || []).filter(evt => matchesTenant(evt.tenantId, tenant));
  const friction = {};
  events
    .filter(evt => evt.resourceType === 'form' || evt.type === 'form_error' || evt.type === 'form_abandonment')
    .forEach(evt => {
      const formKey = evt.metrics?.formId || evt.resourceId || 'unknown';
      friction[formKey] = friction[formKey] || { dropoffs: 0, errors: {}, total: 0 };
      friction[formKey].total += 1;
      if (evt.type === 'form_abandonment') friction[formKey].dropoffs += 1;
      if (evt.metrics?.field && evt.type === 'form_error') {
        friction[formKey].errors[evt.metrics.field] = (friction[formKey].errors[evt.metrics.field] || 0) + 1;
      }
    });

  const maps = Object.entries(friction).map(([formId, data]) => ({
    formId,
    dropoffRate: data.total ? Math.round((data.dropoffs / data.total) * 100) : 0,
    worstFields: Object.entries(data.errors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([field, count]) => ({ field, count })),
    recommendations:
      Object.keys(data.errors).length === 0
        ? ['Form is healthy — continue monitoring.']
        : ['Shorten or reorder highlighted fields', 'Clarify helper text on the top error field']
  }));

  return { forms: safe(maps) };
}

function creativeAngles(stockNumberOrId, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const inventory = inventoryService.list({}, tenant).items || [];
  const unit = stockNumberOrId
    ? inventory.find(item => item.stockNumber === stockNumberOrId || item.id === stockNumberOrId)
    : inventory[0];

  if (!unit) {
    return { angles: [] };
  }

  const base = unit.name || unit.category || 'This unit';
  const angles = [
    {
      label: 'Roadschooling-Ready',
      headline: `${base} with space for school and work on the road`,
      talkingPoints: ['Desk or dinette workspace', 'Solar + battery options for off-grid Wi-Fi', 'Storage for books and gear']
    },
    {
      label: 'Tailgate King',
      headline: `${base} set up for gameday gatherings`,
      talkingPoints: ['Outside kitchen or entertainment', 'Quick awning setup', 'Easy-clean surfaces and roomy fridge']
    },
    {
      label: 'Off-Grid Luxury',
      headline: `${base} built for quiet stays away from hookups`,
      talkingPoints: ['Solar prep or installed', 'Heated/enclosed tanks', 'Generator or lithium-friendly converter']
    }
  ];

  return { angles: safe(angles) };
}

function crossSellPredictor(stockNumberOrId, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const inventory = inventoryService.list({}, tenant).items || [];
  const primary = stockNumberOrId
    ? inventory.find(item => item.stockNumber === stockNumberOrId || item.id === stockNumberOrId)
    : inventory[0];

  const alternatives = inventory
    .filter(item => item.id !== primary?.id)
    .map(item => ({
      stockNumber: item.stockNumber,
      name: item.name,
      reason:
        primary && primary.subCategory && item.subCategory === primary.subCategory
          ? 'Similar floorplan upsell'
          : 'Different drivetrain to broaden options'
    }))
    .slice(0, 10);

  return { primary: primary ? safe(primary) : undefined, recommendations: safe(alternatives) };
}

function selfServicePortal(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const leads = datasets.leads.filter(lead => matchesTenant(lead.tenantId, tenant));
  const onboarding = leads.map(lead => ({
    leadId: lead.id,
    name: lead.name,
    status: lead.status,
    documents: lead.uploadedDocuments || [],
    nextSteps: lead.status === 'won'
      ? ['Schedule delivery', 'Upload insurance']
      : ['Verify ID', 'Share trade photos'],
    signing: {
      enabled: true,
      pending: Boolean(!lead.signedDocuments || lead.signedDocuments.length === 0)
    },
    delivery: lead.deliveryDate || null
  }));

  return { portal: safe({ enabled: true, onboarding }) };
}

function customerBehaviorHeatmap(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const events = (datasets.analytics.events || []).filter(evt => matchesTenant(evt.tenantId, tenant));
  const unitEvents = events.filter(evt => evt.resourceType === 'inventory');
  const grouped = unitEvents.reduce((acc, evt) => {
    const key = evt.resourceId || evt.metrics?.stockNumber || 'unknown';
    acc[key] = acc[key] || { views: 0, zooms: 0, comparisons: 0 };
    acc[key].views += 1;
    if (evt.metrics?.action === 'zoom') acc[key].zooms += 1;
    if (evt.metrics?.action === 'compare') acc[key].comparisons += 1;
    return acc;
  }, {});

  const heatmap = Object.entries(grouped).map(([unitId, stats]) => ({
    unitId,
    views: stats.views,
    photoInterest: stats.zooms,
    comparisons: stats.comparisons,
    interestScore: Math.round(stats.views + stats.zooms * 1.5 + stats.comparisons * 2)
  }));

  return { units: safe(heatmap) };
}

function renderProposalHtml(summary) {
  const unit = summary.unitSummary || {};
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${summary.headline}</title></head>
<body>
  <h1>${summary.headline}</h1>
  <section>
    <h2>Unit Overview</h2>
    <p><strong>Stock:</strong> ${unit.stockNumber || 'N/A'}</p>
    <p><strong>Title:</strong> ${unit.title || 'N/A'}</p>
    <p><strong>Condition:</strong> ${unit.condition || 'N/A'}</p>
    <p><strong>Price Guidance:</strong> ${unit.price || unit.msrp || 'Request pricing'}</p>
    <p><strong>Highlights:</strong> ${unit.storyHighlights || ''}</p>
  </section>
  <section>
    <h2>Trade & Story</h2>
    <p>${summary.trade || 'No trade provided yet.'}</p>
  </section>
  <section>
    <h2>Value Props</h2>
    <ul>${summary.valueProps.map(value => `<li>${value}</li>`).join('')}</ul>
  </section>
  <section>
    <h2>Notes</h2>
    <p>${summary.notes}</p>
  </section>
</body></html>`;
}

function renderProposalPdf(summary) {
  const sections = [
    { label: 'Lead', value: summary.leadName || 'N/A' },
    { label: 'Stock', value: summary.unitSummary?.stockNumber || 'N/A' },
    { label: 'Unit', value: summary.unitSummary?.title || summary.unitSummary?.condition || 'N/A' },
    { label: 'Price Guidance', value: summary.unitSummary?.price || summary.unitSummary?.msrp || 'Request' },
    { label: 'Value Props', value: (summary.valueProps || []).join(' • ') },
    { label: 'Story Highlights', value: summary.unitSummary?.storyHighlights || 'Listed features and walkthrough available.' },
    { label: 'Trade', value: summary.trade || 'No trade provided yet.' },
    { label: 'Notes', value: summary.notes || '' }
  ];

  const escape = text => (text || '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const lines = [summary.headline || 'Proposal Summary', '____________________________________'];

  sections.forEach(section => {
    lines.push(`${section.label}: ${section.value}`);
  });

  const content = ['BT', '/F1 12 Tf', '72 740 Td']
    .concat(
      lines
        .map((line, index) => {
          const prefix = index ? '0 -18 Td\n' : '';
          return `${prefix}(${escape(line)}) Tj`;
        })
        .join('\n')
    )
    .concat(['ET'])
    .join('\n');

  const contentLength = Buffer.byteLength(content);
  const pdf = `%PDF-1.4\n1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj\n2 0 obj <</Type/Pages/Count 1/Kids[3 0 R]>> endobj\n3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>> endobj\n4 0 obj <</Length ${contentLength}>>stream\n${content}\nendstream endobj\n5 0 obj <</Type/Font/Subtype/Type1/BaseFont/Helvetica>> endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
  return Buffer.from(pdf).toString('base64');
}

function deriveCoordinates(entity) {
  const lat = entity.latitude || entity.lat || entity.locationLat || entity.geoLat;
  const lng = entity.longitude || entity.lon || entity.lng || entity.locationLng || entity.geoLng;
  if (lat === undefined || lng === undefined) return undefined;
  return { lat: Number(lat), lng: Number(lng) };
}

function computeDistanceMiles(entity, coordinates, homeCoordinates) {
  const explicit =
    entity.distanceFromStoreMiles ||
    entity.distanceMiles ||
    entity.distance ||
    (entity.metrics ? entity.metrics.distanceMiles : undefined);
  if (explicit !== undefined) return Number(explicit);
  if (coordinates && homeCoordinates) {
    return Number(haversineMiles(coordinates, homeCoordinates).toFixed(1));
  }
  return undefined;
}

function buildRadiusBuckets({ leads = [], events = [], homeCoordinates }) {
  const buckets = [
    { label: '0-25', max: 25, leads: 0, visits: 0 },
    { label: '26-50', max: 50, leads: 0, visits: 0 },
    { label: '51-100', max: 100, leads: 0, visits: 0 },
    { label: '101-200', max: 200, leads: 0, visits: 0 },
    { label: '200+', max: Infinity, leads: 0, visits: 0 },
    { label: 'unknown', max: -1, leads: 0, visits: 0 }
  ];

  const bucketDistance = (distance, kind) => {
    const bucket =
      distance === undefined
        ? buckets.find(b => b.label === 'unknown')
        : buckets.find(b => distance <= b.max);
    if (!bucket) return;
    bucket[kind] += 1;
  };

  leads.forEach(lead => {
    const distance = computeDistanceMiles(lead, deriveCoordinates(lead), homeCoordinates);
    bucketDistance(distance, 'leads');
  });

  events
    .filter(evt => evt.type === 'inventory_view' || evt.type === 'lead')
    .forEach(evt => {
      const distance = computeDistanceMiles(evt, deriveCoordinates(evt.metrics || {}), homeCoordinates);
      bucketDistance(distance, 'visits');
    });

  return buckets.map(bucket => ({ label: bucket.label, leads: bucket.leads, visits: bucket.visits }));
}

function haversineMiles(pointA, pointB) {
  const toRad = deg => (deg * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(pointB.lat - pointA.lat);
  const dLon = toRad(pointB.lng - pointA.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(pointA.lat)) * Math.cos(toRad(pointB.lat)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = {
  listObjections,
  addObjection,
  proposalSummary,
  seoOpportunities,
  trendRadar,
  contentRoi,
  localDemand,
  behaviorHeatmaps,
  deepAttribution,
  merchandisingScores,
  merchandisingQueue,
  modelLifecycleInsights,
  frictionMap,
  creativeAngles,
  crossSellPredictor,
  selfServicePortal,
  customerBehaviorHeatmap
};
