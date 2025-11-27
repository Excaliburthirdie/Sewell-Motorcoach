const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { escapeOutputPayload, sanitizePayloadStrings, validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');
const inventoryService = require('./inventoryService');
const contentPageService = require('./contentPageService');

function safe(profile) {
  return escapeOutputPayload(profile);
}

function normalizePath(value) {
  if (!value) return undefined;
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  if (!value.startsWith('/')) return `/${value}`;
  return value;
}

function list(filter = {}, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const { resourceType, resourceId } = filter;
  return datasets.seoProfiles
    .filter(profile => matchesTenant(profile.tenantId, tenant))
    .filter(profile => {
      if (resourceType && profile.resourceType !== resourceType) return false;
      if (resourceId && profile.resourceId !== resourceId) return false;
      return true;
    })
    .map(safe);
}

function find(resourceType, resourceId, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const profile = datasets.seoProfiles.find(
    entry => entry.resourceType === resourceType && entry.resourceId === resourceId && matchesTenant(entry.tenantId, tenant)
  );
  return profile ? safe(profile) : undefined;
}

function scoreProfile(profile) {
  let score = 0;
  if (profile.metaTitle) score += 15;
  if (profile.metaDescription) score += 15;
  if (profile.focusKeywords && profile.focusKeywords.length) score += 15;
  if (profile.canonicalUrl) score += 10;
  if (profile.openGraph && profile.openGraph.image) score += 10;
  if (profile.schemaMarkup) score += 10;
  if (profile.noindex) score -= 10;
  if (profile.nofollow) score -= 5;
  return Math.max(0, Math.min(100, score + 30));
}

function upsert(payload, tenantId) {
  const requiredError = validateFields(payload, ['resourceType', 'resourceId']);
  if (requiredError) {
    return { error: requiredError };
  }
  const sanitized = sanitizePayloadStrings(payload, [
    'resourceType',
    'resourceId',
    'metaTitle',
    'metaDescription',
    'canonicalUrl',
    'ogTitle',
    'ogDescription'
  ]);

  const existingIndex = datasets.seoProfiles.findIndex(
    entry =>
      entry.resourceType === sanitized.resourceType &&
      entry.resourceId === sanitized.resourceId &&
      matchesTenant(entry.tenantId, tenantId)
  );

  const base = {
    id: existingIndex >= 0 ? datasets.seoProfiles[existingIndex].id : randomUUID(),
    createdAt: existingIndex >= 0 ? datasets.seoProfiles[existingIndex].createdAt : new Date().toISOString()
  };

  const normalized = attachTenant(
    {
      ...base,
      ...sanitized,
      focusKeywords: sanitized.focusKeywords || payload.focusKeywords || [],
      openGraph: {
        image: sanitized.ogImage || payload.ogImage,
        title: sanitized.ogTitle || payload.ogTitle || sanitized.metaTitle,
        description: sanitized.ogDescription || payload.ogDescription || sanitized.metaDescription
      },
      schemaMarkup: payload.schemaMarkup || sanitized.schemaMarkup,
      noindex: Boolean(payload.noindex),
      nofollow: Boolean(payload.nofollow),
      updatedAt: new Date().toISOString(),
      score: undefined
    },
    tenantId
  );
  normalized.score = scoreProfile(normalized);

  if (existingIndex >= 0) {
    datasets.seoProfiles[existingIndex] = normalized;
  } else {
    datasets.seoProfiles.push(normalized);
  }
  persist.seoProfiles(datasets.seoProfiles);
  return { profile: safe(normalized) };
}

function ensureInventoryProfile(item, tenantId) {
  const existing = find('inventory', item.id, tenantId);
  if (existing) return existing;
  const generated = generateInventoryProfile(item, tenantId);
  if (generated.profile) {
    return generated.profile;
  }
  return undefined;
}

function generateInventoryProfile(item, tenantId) {
  if (!item) return { error: 'Inventory item required' };
  const titleParts = [item.year, item.name, item.category, item.location].filter(Boolean);
  const descriptionParts = [
    item.description,
    item.condition ? `${item.condition} condition` : undefined,
    item.length ? `${item.length} ft` : undefined,
    item.weight ? `${item.weight} lbs` : undefined
  ].filter(Boolean);
  const payload = {
    resourceType: 'inventory',
    resourceId: item.id,
    metaTitle: titleParts.join(' | ').slice(0, 60),
    metaDescription: descriptionParts.join(' • ').slice(0, 160),
      canonicalUrl: item.slug ? `/inventory/${item.slug}` : undefined,
    focusKeywords: [item.category, item.industry, item.name].filter(Boolean),
    ogImage: item.images && item.images[0]
  };
  return upsert(payload, tenantId);
}

function generateContentProfile(page, tenantId) {
  if (!page) return { error: 'Content page required' };
  const payload = {
    resourceType: 'content',
    resourceId: page.id,
    metaTitle: page.metaTitle || page.title,
    metaDescription: page.metaDescription || (page.body || '').slice(0, 140),
    canonicalUrl: page.slug ? `/pages/${page.slug}` : undefined,
    focusKeywords: [page.slug, page.title].filter(Boolean)
  };
  return upsert(payload, tenantId);
}

function autofillMissing(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const generated = [];
  const inventoryItems = inventoryService.list({}, tenant).items || inventoryService.list({}, tenant) || [];
  inventoryItems.forEach(item => {
    if (!find('inventory', item.id, tenant)) {
      const { profile } = generateInventoryProfile(item, tenant) || {};
      if (profile) generated.push(profile);
    }
  });

  const pages = contentPageService.list({}, tenant) || [];
  pages.forEach(page => {
    if (!find('content', page.id, tenant)) {
      const { profile } = generateContentProfile(page, tenant) || {};
      if (profile) generated.push(profile);
    }
  });

  return { generated: generated.map(safe) };
}

function seoHealth(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const inventoryItems = inventoryService.list({}, tenant).items || [];
  const contentPages = contentPageService.list({}, tenant) || [];
  const profiles = list({}, tenant);

  const profileFor = (resourceType, id) => profiles.find(p => p.resourceType === resourceType && p.resourceId === id);

  const unitsMissingSeoTitle = inventoryItems.filter(item => {
    const profile = profileFor('inventory', item.id);
    return !(item.metaTitle || profile?.metaTitle);
  }).length;

  const unitsMissingMetaDescription = inventoryItems.filter(item => {
    const profile = profileFor('inventory', item.id);
    return !(item.metaDescription || profile?.metaDescription);
  }).length;

  const pageTitles = contentPages.map(page => {
    const profile = profileFor('content', page.id);
    return (profile && profile.metaTitle) || page.metaTitle || page.title || '';
  });
  const pageDescriptions = contentPages.map(page => {
    const profile = profileFor('content', page.id);
    return (profile && profile.metaDescription) || page.metaDescription || '';
  });

  const duplicateCounts = list => {
    const counts = new Map();
    list
      .map(entry => entry.trim())
      .filter(Boolean)
      .forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
    return Array.from(counts.values()).filter(count => count > 1).length;
  };

  const pagesWithDuplicateTitles = duplicateCounts(pageTitles);
  const pagesWithDuplicateDescriptions = duplicateCounts(pageDescriptions);

  const schemaValidationErrors = profiles.filter(profile => {
    if (!profile.schemaMarkup) return false;
    if (typeof profile.schemaMarkup === 'object') return false;
    if (typeof profile.schemaMarkup === 'string') {
      try {
        JSON.parse(profile.schemaMarkup);
        return false;
      } catch (err) {
        return true;
      }
    }
    return true;
  }).length;

  return {
    tenantId: tenant,
    generatedAt: new Date().toISOString(),
    status: 'ok',
    metrics: {
      unitsMissingSeoTitle: { value: unitsMissingSeoTitle, severity: unitsMissingSeoTitle ? 'warning' : 'ok' },
      unitsMissingMetaDescription: {
        value: unitsMissingMetaDescription,
        severity: unitsMissingMetaDescription ? 'warning' : 'ok'
      },
      pagesWithDuplicateTitles: { value: pagesWithDuplicateTitles, severity: pagesWithDuplicateTitles ? 'warning' : 'ok' },
      pagesWithDuplicateDescriptions: {
        value: pagesWithDuplicateDescriptions,
        severity: pagesWithDuplicateDescriptions ? 'warning' : 'ok'
      },
      schemaValidationErrors: { value: schemaValidationErrors, severity: schemaValidationErrors ? 'error' : 'ok' }
    }
  };
}

function topics(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const pages = contentPageService.list({}, tenant) || [];
  const topicMap = new Map();

  const ensureEntry = topicLabel => {
    const key = (topicLabel || '').toString().trim().toLowerCase();
    if (!key) return undefined;
    if (!topicMap.has(key)) {
      topicMap.set(key, { topic: topicLabel.toString().trim(), relatedTopics: new Set(), pages: [] });
    }
    return topicMap.get(key);
  };

  pages.forEach(page => {
    if (!page.topic) return;
    const entry = ensureEntry(page.topic);
    if (!entry) return;
    const related = Array.isArray(page.relatedTopics)
      ? page.relatedTopics.filter(Boolean)
      : [];
    related.forEach(item => entry.relatedTopics.add(item));
    entry.pages.push({
      id: page.id,
      slug: page.slug,
      title: page.title,
      status: page.status,
      updatedAt: page.updatedAt,
      publishAt: page.publishAt
    });
    related.forEach(label => {
      const sibling = ensureEntry(label);
      if (sibling) sibling.relatedTopics.add(entry.topic);
    });
  });

  return Array.from(topicMap.values()).map(entry => ({
    topic: entry.topic,
    relatedTopics: Array.from(new Set(entry.relatedTopics)),
    pages: entry.pages
  }));
}

function defaultCanonical(resourceType, resource) {
  if (!resource) return undefined;
  if (resourceType === 'inventory') {
    const slug = resource.slug || resource.id;
    return `/inventory/${slug}`;
  }
  if (resourceType === 'content') {
    const slug = resource.slug || resource.id;
    return `/pages/${slug}`;
  }
  return undefined;
}

function resolveCanonical(resourceType, resourceId, tenantId, resourceLoader) {
  const profile = find(resourceType, resourceId, tenantId);
  if (profile?.canonicalUrl) {
    return normalizePath(profile.canonicalUrl);
  }
  const resource = resourceLoader ? resourceLoader() : undefined;
  return normalizePath(defaultCanonical(resourceType, resource));
}

module.exports = {
  list,
  find,
  upsert,
  autofillMissing,
  generateInventoryProfile,
  generateContentProfile,
  ensureInventoryProfile,
  seoHealth,
  topics,
  resolveCanonical,
  defaultCanonical,
  normalizePath
};
