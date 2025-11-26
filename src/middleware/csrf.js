const crypto = require('crypto');

const config = require('../config');
const { AppError } = require('./errors');

const CSRF_COOKIE_NAME = 'csrfToken';
const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

const cookieOptions = {
  httpOnly: true,
  sameSite: config.cookies.sameSite,
  secure: config.cookies.secure,
  domain: config.cookies.domain,
  path: config.cookies.path
};

function parseCookies(header) {
  if (!header) return {};
  return header.split(';').reduce((acc, pair) => {
    const [key, ...rest] = pair.trim().split('=');
    acc[key] = rest.join('=');
    return acc;
  }, {});
}

function serializeCookie(name, value, options) {
  const parts = [`${name}=${value}`];
  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.secure) parts.push('Secure');
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.sameSite) {
    const normalizedSameSite = options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1);
    parts.push(`SameSite=${normalizedSameSite}`);
  }
  return parts.join('; ');
}

function ensureCsrfToken(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  let token = cookies[CSRF_COOKIE_NAME];

  if (!token) {
    token = crypto.randomBytes(32).toString('hex');
    res.append('Set-Cookie', serializeCookie(CSRF_COOKIE_NAME, token, cookieOptions));
  }

  res.set('X-CSRF-Token', token);
  return token;
}

function csrfProtection(req, res, next) {
  const token = ensureCsrfToken(req, res);
  if (SAFE_METHODS.includes(req.method)) {
    return next();
  }

  const headerToken = req.headers[CSRF_HEADER];
  if (!headerToken || headerToken !== token) {
    return next(new AppError('CSRF_TOKEN_INVALID', 'Invalid or missing CSRF token', 403));
  }

  return next();
}

module.exports = { csrfProtection, ensureCsrfToken };
