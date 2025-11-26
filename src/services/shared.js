function clampNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return fallback;
}

function validateFields(payload, requiredFields = []) {
  const missing = requiredFields.filter(
    field => payload[field] === undefined || payload[field] === null || payload[field] === ''
  );
  if (missing.length) {
    return `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`;
  }
  return null;
}

function sanitizeString(value) {
  if (typeof value !== 'string') return value;
  const withoutControls = value.replace(/[\u0000-\u001F\u007F]+/g, '');
  const withoutTags = withoutControls.replace(/<\/?script[^>]*>/gi, '').replace(/[<>]/g, '');
  return withoutTags.trim();
}

function escapeForOutput(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

function sanitizePayloadStrings(payload, fields = []) {
  const sanitized = { ...payload };
  fields.forEach(field => {
    if (sanitized[field] !== undefined) {
      sanitized[field] = sanitizeString(sanitized[field]);
    }
  });
  return sanitized;
}

function escapeOutputPayload(value) {
  if (typeof value === 'string') return escapeForOutput(value);
  if (Array.isArray(value)) return value.map(escapeOutputPayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, escapeOutputPayload(val)]));
  }
  return value;
}

module.exports = {
  clampNumber,
  sanitizeBoolean,
  sanitizePayloadStrings,
  sanitizeString,
  escapeOutputPayload,
  escapeForOutput,
  validateFields
};
