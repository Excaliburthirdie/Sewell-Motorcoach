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

function hasSlugConflict(slug, tenantId, ignoreId) {
  const tenant = normalizeTenantId(tenantId);
  return datasets.contentPages.some(
    page => page.slug === slug && matchesTenant(page.tenantId, tenant) && page.id !== ignoreId
  );
}

function list(query = {}, tenantId) {
  const { search } = query;
  const tenant = normalizeTenantId(tenantId);
  const filtered = datasets.contentPages
    .filter(page => matchesTenant(page.tenantId, tenant))
    .filter(page => {
      if (!search) return true;
      const term = search.toLowerCase();
      return [page.title, page.body, page.slug].some(value =>
        value ? value.toLowerCase().includes(term) : false
      );
    })
    .map(safePage);
  return filtered;
}

function findBySlug(slug, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const page = datasets.contentPages.find(p => p.slug === slug && matchesTenant(p.tenantId, tenant));
  return page ? safePage(page) : undefined;
}

function findById(id, tenantId) {
  const page = datasets.contentPages.find(p => p.id === id && matchesTenant(p.tenantId, tenantId));
  return page ? safePage(page) : undefined;
}

function create(payload, tenantId) {
  const requiredError = validateFields(payload, ['title', 'body']);
  if (requiredError) {
    return { error: requiredError };
  }
  const sanitized = sanitizePayloadStrings(payload, ['title', 'body', 'slug', 'metaTitle', 'metaDescription']);
  const slug = slugify(sanitized.slug || sanitized.title);
  if (!slug) {
    return { error: 'Slug is required for content pages' };
  }
  if (hasSlugConflict(slug, tenantId)) {
    return { conflict: 'Slug must be unique per tenant' };
  }
  const page = attachTenant(
    {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...sanitized,
      slug
    },
    tenantId
  );
  datasets.contentPages.push(page);
  persist.contentPages(datasets.contentPages);
  return { page: safePage(page) };
}

function update(id, payload, tenantId) {
  const index = datasets.contentPages.findIndex(p => p.id === id && matchesTenant(p.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const sanitized = sanitizePayloadStrings(payload, ['title', 'body', 'slug', 'metaTitle', 'metaDescription']);
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

module.exports = {
  list,
  findBySlug,
  findById,
  create,
  update,
  remove
};
