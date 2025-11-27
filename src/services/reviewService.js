const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { sanitizePayloadStrings, validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');

function list(query = {}, tenantId) {
  const { rating, limit, offset } = query;
  const tenant = normalizeTenantId(tenantId);
  const filtered = datasets.reviews
    .filter(review => matchesTenant(review.tenantId, tenant))
    .filter(review => (!rating ? true : Number(review.rating) === Number(rating)));

  const start = offset ? Number(offset) : 0;
  const end = limit ? start + Number(limit) : filtered.length;
  return filtered.slice(start, end);
}

function create(payload, tenantId) {
  const requiredError = validateFields(payload, ['customerName', 'rating', 'comment']);
  if (requiredError) {
    return { error: requiredError };
  }

  const body = sanitizePayloadStrings(payload, ['customerName', 'comment']);
  const review = attachTenant({
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...body
  }, tenantId);

  datasets.reviews.push(review);
  persist.reviews(datasets.reviews);
  return { review };
}

function update(id, payload, tenantId) {
  const index = datasets.reviews.findIndex(r => r.id === id && matchesTenant(r.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const body = sanitizePayloadStrings(payload, ['customerName', 'comment']);
  datasets.reviews[index] = { ...datasets.reviews[index], ...body };
  persist.reviews(datasets.reviews);
  return { review: datasets.reviews[index] };
}

function remove(id, tenantId) {
  const index = datasets.reviews.findIndex(r => r.id === id && matchesTenant(r.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const [removed] = datasets.reviews.splice(index, 1);
  persist.reviews(datasets.reviews);
  return { review: removed };
}

module.exports = {
  list,
  create,
  update,
  remove
};
