const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');
const { sanitizePayloadStrings, validateFields, escapeOutputPayload } = require('./shared');

function safeOffer(offer) {
  return escapeOutputPayload(offer);
}

function list(query = {}, tenantId) {
  const { vehicleCategory } = query;
  const limit = Math.max(0, Number(query.limit ?? 50));
  const offset = Math.max(0, Number(query.offset ?? 0));
  const tenant = normalizeTenantId(tenantId);
  const filtered = datasets.financeOffers
    .filter(offer => matchesTenant(offer.tenantId, tenant))
    .filter(offer => (vehicleCategory ? offer.vehicleCategory === vehicleCategory : true));
  const items = filtered.slice(offset, offset + limit).map(safeOffer);
  return { items, total: filtered.length, limit, offset };
}

function findById(id, tenantId) {
  const offer = datasets.financeOffers.find(entry => entry.id === id && matchesTenant(entry.tenantId, tenantId));
  return offer ? safeOffer(offer) : undefined;
}

function create(payload, tenantId) {
  const requiredError = validateFields(payload, ['lender', 'termMonths', 'apr']);
  if (requiredError) {
    return { error: requiredError };
  }
  const body = sanitizePayloadStrings(payload, ['lender', 'restrictions', 'vehicleCategory']);
  const offer = attachTenant(
    {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      termMonths: Number(body.termMonths),
      apr: Number(body.apr),
      downPayment: Number(body.downPayment || 0),
      ...body
    },
    tenantId
  );
  datasets.financeOffers.push(offer);
  persist.financeOffers(datasets.financeOffers);
  return { offer: safeOffer(offer) };
}

function update(id, payload, tenantId) {
  const index = datasets.financeOffers.findIndex(entry => entry.id === id && matchesTenant(entry.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const body = sanitizePayloadStrings(payload, ['lender', 'restrictions', 'vehicleCategory']);
  datasets.financeOffers[index] = {
    ...datasets.financeOffers[index],
    ...body,
    termMonths: payload.termMonths !== undefined ? Number(payload.termMonths) : datasets.financeOffers[index].termMonths,
    apr: payload.apr !== undefined ? Number(payload.apr) : datasets.financeOffers[index].apr,
    downPayment:
      payload.downPayment !== undefined ? Number(payload.downPayment) : datasets.financeOffers[index].downPayment
  };
  persist.financeOffers(datasets.financeOffers);
  return { offer: safeOffer(datasets.financeOffers[index]) };
}

function remove(id, tenantId) {
  const index = datasets.financeOffers.findIndex(entry => entry.id === id && matchesTenant(entry.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const [removed] = datasets.financeOffers.splice(index, 1);
  persist.financeOffers(datasets.financeOffers);
  return { offer: safeOffer(removed) };
}

module.exports = {
  list,
  findById,
  create,
  update,
  remove
};
