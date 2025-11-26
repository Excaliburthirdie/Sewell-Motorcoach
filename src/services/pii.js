const cloneDeep = input => {
  if (Array.isArray(input)) return input.map(cloneDeep);
  if (input && typeof input === 'object') {
    return Object.keys(input).reduce((acc, key) => {
      acc[key] = cloneDeep(input[key]);
      return acc;
    }, {});
  }
  return input;
};

function maskEmail(value, replacement) {
  if (typeof value !== 'string') return value;
  const [user, domain] = value.split('@');
  if (!domain) return replacement;
  const visible = user.slice(-2);
  const maskedUser = `${replacement.repeat(Math.max(user.length - 2, 3))}${visible}`;
  return `${maskedUser}@${domain}`;
}

function maskString(value, replacement, keep = 2) {
  if (typeof value !== 'string') return value;
  if (value.length <= keep) return replacement.repeat(value.length);
  const visible = value.slice(-keep);
  return `${replacement.repeat(Math.max(value.length - keep, 3))}${visible}`;
}

function shouldMaskKey(key, sensitiveKeys = []) {
  const lowered = key.toLowerCase();
  return sensitiveKeys.some(candidate => lowered.includes(candidate));
}

function maskValue(value, replacement, sensitiveKeys) {
  if (typeof value === 'string' && /@/.test(value) && shouldMaskKey('email', sensitiveKeys)) {
    return maskEmail(value, replacement);
  }
  if (typeof value === 'string') {
    return maskString(value, replacement);
  }
  return value;
}

function applyMask(input, options = {}) {
  const { enabled = true, replacement = '*', sensitiveKeys = [] } = options;
  if (!enabled) return input;
  const clone = cloneDeep(input);
  const walker = value => {
    if (Array.isArray(value)) return value.map(walker);
    if (value && typeof value === 'object') {
      return Object.entries(value).reduce((acc, [key, val]) => {
        if (val && typeof val === 'object') {
          acc[key] = walker(val);
        } else if (shouldMaskKey(key, sensitiveKeys)) {
          acc[key] = maskValue(val, replacement, sensitiveKeys);
        } else {
          acc[key] = val;
        }
        return acc;
      }, {});
    }
    return value;
  };
  return walker(clone);
}

function maskForLogs(payload, options) {
  return applyMask(payload, options);
}

function maskForResponse(payload, options) {
  return applyMask(payload, options);
}

module.exports = {
  maskForLogs,
  maskForResponse
};
