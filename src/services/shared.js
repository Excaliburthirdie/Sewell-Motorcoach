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
  const missing = requiredFields.filter(field => payload[field] === undefined || payload[field] === null || payload[field] === '');
  if (missing.length) {
    return `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`;
  }
  return null;
}

function sanitizeString(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/[<>]/g, '');
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

module.exports = {
  clampNumber,
  sanitizeBoolean,
  sanitizePayloadStrings,
  sanitizeString,
  validateFields
};
