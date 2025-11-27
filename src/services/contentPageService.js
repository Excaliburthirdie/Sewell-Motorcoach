const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { escapeOutputPayload, sanitizePayloadStrings, validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');

function slugify(value) {
  if (!value) return undefined;
  return value
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function safePage(page) {
  return escapeOutputPayload(page);
}

function computeLiveStatus(page) {
  if (!page.status) return 'published';
  if (page.status === 'scheduled' && page.publishAt && new Date(page.publishAt) <= new Date()) {
    return 'published';
  }
  return page.status;
}

function isLive(page) {
  const status = computeLiveStatus(page);
  return status === 'published';
}

function promoteIfReady(page) {
  if (page.status === 'scheduled' && page.publishAt && new Date(page.publishAt) <= new Date()) {
    const updated = { ...page, status: 'published', publishedAt: page.publishedAt || new Date().toISOString() };
    const index = datasets.contentPages.findIndex(entry => entry.id === page.id && matchesTenant(entry.tenantId, page.tenantId));
    if (index !== -1) {
      datasets.contentPages[index] = updated;
      persist.contentPages(datasets.contentPages);
    }
    return updated;
  }
  return page;
}

function hasSlugConflict(slug, tenantId, ignoreId) {
  const tenant = normalizeTenantId(tenantId);
  return datasets.contentPages.some(
    page => page.slug === slug && matchesTenant(page.tenantId, tenant) && page.id !== ignoreId
  );
}

function list(query = {}, tenantId) {
  const { search, status } = query;
  const tenant = normalizeTenantId(tenantId);
  const filtered = datasets.contentPages
    .filter(page => matchesTenant(page.tenantId, tenant))
    .map(promoteIfReady)
    .filter(page => {
      if (status && computeLiveStatus(page) !== status) return false;
      if (!search) return true;
      const term = search.toLowerCase();
      return [page.title, page.body, page.slug].some(value =>
        value ? value.toLowerCase().includes(term) : false
      );
    })
    .map(safePage);
  return filtered;
}

function findBySlug(slug, tenantId, options = {}) {
  const tenant = normalizeTenantId(tenantId);
  const page = datasets.contentPages
    .map(promoteIfReady)
    .find(p => p.slug === slug && matchesTenant(p.tenantId, tenant));
  if (!page) return undefined;
  if (options.preview) return safePage(page);
  if (!isLive(page)) return undefined;
  return safePage(page);
}

function findById(id, tenantId, options = {}) {
  const page = datasets.contentPages
    .map(promoteIfReady)
    .find(p => p.id === id && matchesTenant(p.tenantId, tenantId));
  if (!page) return undefined;
  if (options.preview) return safePage(page);
  if (!isLive(page)) return undefined;
  return safePage(page);
}

function create(payload, tenantId, actor) {
  const requiredError = validateFields(payload, ['title', 'body']);
  if (requiredError) {
    return { error: requiredError };
  }
  const sanitized = sanitizePayloadStrings(payload, [
    'title',
    'body',
    'slug',
    'metaTitle',
    'metaDescription',
    'status',
    'updatedBy',
    'publishedBy',
    'publishAt'
  ]);
  const slug = slugify(sanitized.slug || sanitized.title);
  if (!slug) {
    return { error: 'Slug is required for content pages' };
  }
  if (hasSlugConflict(slug, tenantId)) {
    return { conflict: 'Slug must be unique per tenant' };
  }
  const now = new Date().toISOString();
  const page = attachTenant(
    {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: sanitized.status || 'draft',
      publishAt: sanitized.publishAt,
      updatedBy: sanitized.updatedBy || actor,
      publishedBy: sanitized.publishedBy,
      ...sanitized,
      slug
    },
    tenantId
  );
  datasets.contentPages.push(page);
  persist.contentPages(datasets.contentPages);
  return { page: safePage(page) };
}

function update(id, payload, tenantId, actor) {
  const index = datasets.contentPages.findIndex(p => p.id === id && matchesTenant(p.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const sanitized = sanitizePayloadStrings(payload, [
    'title',
    'body',
    'slug',
    'metaTitle',
    'metaDescription',
    'status',
    'publishedBy',
    'updatedBy',
    'publishAt'
  ]);
  const slug = slugify(sanitized.slug || sanitized.title || datasets.contentPages[index].title);
  if (!slug) {
    return { error: 'Slug is required for content pages' };
  }
  if (hasSlugConflict(slug, tenantId, id)) {
    return { conflict: 'Slug must be unique per tenant' };
  }
  const updated = {
    ...datasets.contentPages[index],
    ...sanitized,
    slug,
    updatedBy: actor || sanitized.updatedBy || datasets.contentPages[index].updatedBy,
    updatedAt: new Date().toISOString()
  };
  datasets.contentPages[index] = updated;
  persist.contentPages(datasets.contentPages);
  return { page: safePage(updated) };
}

function remove(id, tenantId) {
  const index = datasets.contentPages.findIndex(p => p.id === id && matchesTenant(p.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const [removed] = datasets.contentPages.splice(index, 1);
  persist.contentPages(datasets.contentPages);
  return { page: safePage(removed) };
}

function publish(id, tenantId, publishAt, actor) {
  const index = datasets.contentPages.findIndex(p => p.id === id && matchesTenant(p.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const now = new Date();
  const scheduledDate = publishAt ? new Date(publishAt) : now;
  const status = scheduledDate > now ? 'scheduled' : 'published';
  const updated = {
    ...datasets.contentPages[index],
    status,
    publishAt: scheduledDate.toISOString(),
    publishedAt: status === 'published' ? now.toISOString() : undefined,
    publishedBy: actor,
    updatedAt: now.toISOString()
  };
  datasets.contentPages[index] = updated;
  persist.contentPages(datasets.contentPages);
  return { page: safePage(updated) };
}

module.exports = {
  list,
  findBySlug,
  findById,
  create,
  update,
  remove,
  publish
};
