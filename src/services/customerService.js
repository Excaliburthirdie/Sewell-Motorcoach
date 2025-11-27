const { randomUUID } = require('node:crypto');
const { datasets, persist } = require('./state');
const { attachTenant, matchesTenant, normalizeTenantId } = require('./tenantService');
const { sanitizePayloadStrings, validateFields, escapeOutputPayload, sanitizeBoolean } = require('./shared');

const CONTACT_METHODS = ['email', 'phone', 'text'];

function sanitizeCustomer(payload) {
  const sanitized = sanitizePayloadStrings(payload, ['firstName', 'lastName', 'email', 'phone', 'notes']);
  if (sanitized.preferredContactMethod && !CONTACT_METHODS.includes(sanitized.preferredContactMethod)) {
    delete sanitized.preferredContactMethod;
  }
  sanitized.marketingOptIn = sanitizeBoolean(payload.marketingOptIn, false);
  return sanitized;
}

function safeCustomer(customer) {
  return escapeOutputPayload(customer);
}

function list(query = {}, tenantId) {
  const { search, marketingOptIn } = query;
  const limit = Math.max(0, Number(query.limit ?? 50));
  const offset = Math.max(0, Number(query.offset ?? 0));
  const tenant = normalizeTenantId(tenantId);
  const scoped = datasets.customers.filter(customer => matchesTenant(customer.tenantId, tenant));
  const filtered = scoped.filter(customer => {
    if (marketingOptIn !== undefined && sanitizeBoolean(marketingOptIn) !== customer.marketingOptIn) {
      return false;
    }
    if (!search) return true;
    const haystack = `${customer.firstName || ''} ${customer.lastName || ''} ${customer.email || ''} ${
      customer.phone || ''
    }`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  const items = filtered.slice(offset, offset + limit).map(safeCustomer);
  return { items, total: filtered.length, limit, offset };
}

function findById(id, tenantId) {
  const customer = datasets.customers.find(entry => entry.id === id && matchesTenant(entry.tenantId, tenantId));
  return customer ? safeCustomer(customer) : undefined;
}

function create(payload, tenantId) {
  const requiredError = validateFields(payload, ['firstName', 'lastName']);
  if (requiredError) {
    return { error: requiredError };
  }
  if (!payload.email && !payload.phone) {
    return { error: 'Either email or phone is required' };
  }

  const body = sanitizeCustomer(payload);
  const customer = attachTenant(
    {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...body
    },
    tenantId
  );
  datasets.customers.push(customer);
  persist.customers(datasets.customers);
  return { customer: safeCustomer(customer) };
}

function update(id, payload, tenantId) {
  const index = datasets.customers.findIndex(entry => entry.id === id && matchesTenant(entry.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const updates = sanitizeCustomer(payload);
  datasets.customers[index] = { ...datasets.customers[index], ...updates };
  persist.customers(datasets.customers);
  return { customer: safeCustomer(datasets.customers[index]) };
}

function remove(id, tenantId) {
  const index = datasets.customers.findIndex(entry => entry.id === id && matchesTenant(entry.tenantId, tenantId));
  if (index === -1) {
    return { notFound: true };
  }
  const [removed] = datasets.customers.splice(index, 1);
  persist.customers(datasets.customers);
  return { customer: safeCustomer(removed) };
}

module.exports = {
  CONTACT_METHODS,
  list,
  findById,
  create,
  update,
  remove
};
