const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { escapeOutputPayload, sanitizePayloadStrings, validateFields } = require('./shared');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');

function safe(experiment) {
  return escapeOutputPayload(experiment);
}

function summarizeMetrics(experiment, tenantId) {
  const events = (datasets.analytics.events || []).filter(
    event => matchesTenant(event.tenantId, tenantId) && event.experimentId === experiment.id
  );

  const variantSummary = (experiment.variants || []).reduce((acc, variant) => {
    acc[variant.id] = { id: variant.id, count: 0, metrics: {} };
    return acc;
  }, {});

  events.forEach(event => {
    const targetVariant = variantSummary[event.variantId];
    if (targetVariant) {
      targetVariant.count += 1;
      Object.entries(event.metrics || {}).forEach(([key, value]) => {
        if (!targetVariant.metrics[key]) {
          targetVariant.metrics[key] = 0;
        }
        if (typeof value === 'number') {
          targetVariant.metrics[key] += value;
        }
      });
    }
  });

  return Object.values(variantSummary);
}

function getById(id, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  const experiment = datasets.experiments.find(entry => entry.id === id && matchesTenant(entry.tenantId, tenant));
  if (!experiment) return { notFound: true };
  return { experiment: safe(experiment), metrics: summarizeMetrics(experiment, tenant) };
}

function create(payload, tenantId, actor) {
  const requiredError = validateFields(payload, ['name', 'targetSlug', 'variantType', 'variants']);
  if (requiredError) {
    return { error: requiredError };
  }
  const sanitized = sanitizePayloadStrings(payload, ['name', 'targetSlug', 'variantType', 'status']);
  const variants = Array.isArray(payload.variants)
    ? payload.variants.map(variant => ({
        id: variant.id || randomUUID(),
        weight: Number(variant.weight ?? 1),
        pageIdOrBlockConfig: variant.pageIdOrBlockConfig,
        label: variant.label || variant.id
      }))
    : [];
  const experiment = attachTenant(
    {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: actor,
      status: sanitized.status || 'draft',
      metrics: payload.metrics || [],
      ...sanitized,
      variants
    },
    tenantId
  );
  datasets.experiments.push(experiment);
  persist.experiments(datasets.experiments);
  return { experiment: safe(experiment) };
}

function update(id, payload, tenantId, actor) {
  const index = datasets.experiments.findIndex(exp => exp.id === id && matchesTenant(exp.tenantId, tenantId));
  if (index === -1) return { notFound: true };
  const sanitized = sanitizePayloadStrings(payload, ['name', 'targetSlug', 'variantType', 'status']);
  const baseVariants = datasets.experiments[index].variants || [];
  const variants = Array.isArray(payload.variants)
    ? payload.variants.map(variant => ({
        id: variant.id || randomUUID(),
        weight: Number(variant.weight ?? 1),
        pageIdOrBlockConfig: variant.pageIdOrBlockConfig,
        label: variant.label || variant.id
      }))
    : baseVariants;
  const updated = {
    ...datasets.experiments[index],
    ...sanitized,
    variants,
    metrics: payload.metrics || datasets.experiments[index].metrics,
    updatedBy: actor || payload.updatedBy || datasets.experiments[index].updatedBy,
    updatedAt: new Date().toISOString()
  };
  datasets.experiments[index] = updated;
  persist.experiments(datasets.experiments);
  return { experiment: safe(updated) };
}

module.exports = {
  getById,
  create,
  update,
  summarizeMetrics
};
