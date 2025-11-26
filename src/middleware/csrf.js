const crypto = require('crypto');
const config = require('../config');
const { AppError } = require('./errors');

const COOKIE_SECURE = config.env === 'production' || config.server.enforceHttps;
const SAME_SITE = COOKIE_SECURE ? 'none' : 'lax';

const CSRF_COOKIE_OPTIONS = {
  secure: COOKIE_SECURE,
  sameSite: SAME_SITE,
  httpOnly: false,
  path: '/',
  maxAge: config.csrf.cookieTtlSeconds * 1000
};

function issueCsrfToken(res) {
  const token = crypto.randomBytes(32).toString('hex');
  res.cookie(config.csrf.cookieName, token, CSRF_COOKIE_OPTIONS);
  res.set('X-CSRF-Token', token);
  return token;
}

function ensureCsrfToken(req, res, next) {
  if (!config.csrf.enabled) return next();
  const existing = req.cookies?.[config.csrf.cookieName];
  if (existing) {
    req.csrfToken = existing;
    res.set('X-CSRF-Token', existing);
    return next();
  }
  req.csrfToken = issueCsrfToken(res);
  req.csrfTokenIssued = true;
  return next();
}

function requireCsrfToken(req, res, next) {
  if (!config.csrf.enabled) return next();

  const method = (req.method || '').toUpperCase();
  if (!config.csrf.protectedMethods.includes(method)) {
    return next();
  }

  const headerToken = req.headers[config.csrf.headerName];
  const cookieToken = req.cookies?.[config.csrf.cookieName];
  const hasRefreshCookie = Boolean(req.cookies?.refreshToken);

  if (!cookieToken) {
    req.csrfToken = issueCsrfToken(res);
    if (hasRefreshCookie) {
      return next(new AppError('CSRF_TOKEN_MISSING', 'CSRF token missing for authenticated request', 403));
    }
    return next();
  }

  if (!headerToken || headerToken !== cookieToken) {
    if (req.csrfTokenIssued && !hasRefreshCookie) {
      return next();
    }
    return next(new AppError('CSRF_TOKEN_INVALID', 'CSRF token missing or invalid', 403));
  }

  return next();
}

module.exports = {
  CSRF_COOKIE_OPTIONS,
  ensureCsrfToken,
  issueCsrfToken,
  requireCsrfToken
};
