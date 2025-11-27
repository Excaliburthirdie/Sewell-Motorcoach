const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { escapeOutputPayload, sanitizePayloadStrings, validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');
const inventoryService = require('./inventoryService');
const contentPageService = require('./contentPageService');

function safe(profile) {
  return escapeOutputPayload(profile);
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

module.exports = {
  list,
  find,
  upsert,
  autofillMissing,
  generateInventoryProfile,
  generateContentProfile,
  ensureInventoryProfile
};
