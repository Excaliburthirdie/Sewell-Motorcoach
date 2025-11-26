const config = require('../config');
const { sanitizeString } = require('./shared');

const MASK_VALUE = '[MASKED]';

function maskSensitiveFields(value, maskFields = config.security.piiMaskFields) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return sanitizeString(value);
  }
  if (Array.isArray(value)) {
    return value.map(v => maskSensitiveFields(v, maskFields));
  }
  if (typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, val]) => {
      if (maskFields.includes(key)) {
        acc[key] = MASK_VALUE;
      } else if (typeof val === 'string' && /@/.test(val)) {
        acc[key] = MASK_VALUE;
      } else if (typeof val === 'string' && /\d{3}[- ]?\d{2}[- ]?\d{4}/.test(val)) {
        acc[key] = MASK_VALUE;
      } else {
        acc[key] = maskSensitiveFields(val, maskFields);
      }
      return acc;
    }, Array.isArray(value) ? [] : {});
  }
  return value;
}

module.exports = {
  maskSensitiveFields
};
