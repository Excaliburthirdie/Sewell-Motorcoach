const CONTROL_CHARS_REGEX = /[\u0000-\u001f\u007f]/g;
const HTML_ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '`': '&#x60;'
};
const HTML_ESCAPE_REGEX = /[&<>"'`]/g;

function sanitizeInput(value) {
  if (typeof value === 'string') {
    return value.replace(CONTROL_CHARS_REGEX, '').trim();
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeInput);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).reduce((acc, key) => {
      acc[key] = sanitizeInput(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function escapeString(value) {
  return value.replace(HTML_ESCAPE_REGEX, match => HTML_ESCAPE_MAP[match] || match);
}

function escapeOutput(value) {
  if (typeof value === 'string') {
    return escapeString(value);
  }
  if (Array.isArray(value)) {
    return value.map(escapeOutput);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).reduce((acc, key) => {
      acc[key] = escapeOutput(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function sanitizeMiddleware(req, res, next) {
  if (req.body) req.body = sanitizeInput(req.body);
  if (req.query) req.query = sanitizeInput(req.query);
  if (req.params) req.params = sanitizeInput(req.params);

  const originalJson = res.json.bind(res);
  res.json = payload => originalJson(escapeOutput(payload));

  next();
}

module.exports = {
  sanitizeMiddleware,
  sanitizeInput,
  escapeOutput
};
