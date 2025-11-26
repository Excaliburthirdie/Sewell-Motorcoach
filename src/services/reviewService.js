const { v4: uuidv4 } = require('uuid');
const { datasets, persist } = require('./state');
const { clampNumber, sanitizeBoolean, validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');

function list(tenantId) {
  const tenant = normalizeTenantId(tenantId);
  return datasets.reviews.filter(review => matchesTenant(review.tenantId, tenant));
}

function findById(id, tenantId) {
  return datasets.reviews.find(r => r.id === id && matchesTenant(r.tenantId, tenantId));
}

function create(payload, tenantId) {

function list() {
  return datasets.reviews;
}

function findById(id) {
  return datasets.reviews.find(r => r.id === id);
}

function create(payload) {
  const requiredError = validateFields(payload, ['name', 'rating', 'content']);
  if (requiredError) {
    return { error: requiredError };
  }

  const rating = clampNumber(payload.rating, 0);
  if (rating < 1 || rating > 5) {
    return { error: 'Rating must be between 1 and 5' };
  }

  const review = attachTenant(
    {
      id: uuidv4(),
      visible: sanitizeBoolean(payload.visible, true),
      createdAt: new Date().toISOString(),
      rating,
      ...payload
    },
    tenantId
  );
  const review = {
    id: uuidv4(),
    visible: sanitizeBoolean(payload.visible, true),
    createdAt: new Date().toISOString(),
    rating,
    ...payload
  };

  datasets.reviews.push(review);
  persist.reviews(datasets.reviews);
  return { review };
}

function update(id, payload, tenantId) {
  const index = datasets.reviews.findIndex(r => r.id === id && matchesTenant(r.tenantId, tenantId));
function update(id, payload) {
  const index = datasets.reviews.findIndex(r => r.id === id);
  if (index === -1) {
    return { notFound: true };
  }

  const rating = payload.rating ? clampNumber(payload.rating, datasets.reviews[index].rating) : datasets.reviews[index].rating;
  if (rating < 1 || rating > 5) {
    return { error: 'Rating must be between 1 and 5' };
  }

  datasets.reviews[index] = {
    ...datasets.reviews[index],
    ...payload,
    rating,
    visible: sanitizeBoolean(payload.visible, datasets.reviews[index].visible)
  };
  persist.reviews(datasets.reviews);
  return { review: datasets.reviews[index] };
}

function toggleVisibility(id, visible, tenantId) {
  const index = datasets.reviews.findIndex(r => r.id === id && matchesTenant(r.tenantId, tenantId));
function toggleVisibility(id, visible) {
  const index = datasets.reviews.findIndex(r => r.id === id);
  if (index === -1) {
    return { notFound: true };
  }

  datasets.reviews[index] = {
    ...datasets.reviews[index],
    visible: sanitizeBoolean(visible, !datasets.reviews[index].visible)
  };
  persist.reviews(datasets.reviews);
  return { review: datasets.reviews[index] };
}

function remove(id, tenantId) {
  const index = datasets.reviews.findIndex(r => r.id === id && matchesTenant(r.tenantId, tenantId));
function remove(id) {
  const index = datasets.reviews.findIndex(r => r.id === id);
  if (index === -1) {
    return { notFound: true };
  }
  const [removed] = datasets.reviews.splice(index, 1);
  persist.reviews(datasets.reviews);
  return { review: removed };
}

function summary(tenantId) {
  const scoped = datasets.reviews.filter(r => matchesTenant(r.tenantId, tenantId));
  const visibleReviews = scoped.filter(r => r.visible !== false);
function summary() {
  const visibleReviews = datasets.reviews.filter(r => r.visible !== false);
  const averageRating =
    visibleReviews.length > 0
      ? visibleReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / visibleReviews.length
      : 0;

  return {
    total: scoped.length,
    total: datasets.reviews.length,
    visible: visibleReviews.length,
    averageRating
  };
}

module.exports = {
  list,
  findById,
  create,
  update,
  toggleVisibility,
  remove,
  summary
};
