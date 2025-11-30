module.exports = {
  env: process.env.NODE_ENV || 'development',
  server: {
    port: Number(process.env.PORT || 3000),
    enforceHttps: process.env.ENFORCE_HTTPS === 'true',
    hstsMaxAgeSeconds: Number(process.env.HSTS_MAX_AGE_SECONDS || 31536000),
    jsonLimitMb: Number(process.env.JSON_BODY_LIMIT_MB || 1),
    compressionEnabled: process.env.COMPRESSION_ENABLED !== 'false'
  },
  auth: {
    apiKey: process.env.API_KEY || process.env.ADMIN_API_KEY,
    jwtSecret: process.env.JWT_SECRET || 'change-me-in-prod',
    accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 900),
    refreshTokenTtlSeconds: Number(process.env.REFRESH_TOKEN_TTL_SECONDS || 60 * 60 * 24 * 7),
    passwordSalt: process.env.PASSWORD_SALT || 'static-salt'
  },
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.RATE_LIMIT_MAX || 300)
  },
  csrf: {
    enabled: process.env.CSRF_ENABLED !== 'false',
    cookieName: process.env.CSRF_COOKIE_NAME || 'csrfToken',
    headerName: (process.env.CSRF_HEADER_NAME || 'x-csrf-token').toLowerCase(),
    cookieTtlSeconds: Number(process.env.CSRF_COOKIE_TTL_SECONDS || 60 * 60 * 24),
    protectedMethods: (process.env.CSRF_PROTECTED_METHODS || 'POST,PUT,PATCH,DELETE')
      .split(',')
      .map(method => method.trim().toUpperCase())
      .filter(Boolean)
  },
  ai: {
    enableWebFetch: process.env.AI_WEB_FETCH === 'true',
    fetchTimeoutMs: Number(process.env.AI_FETCH_TIMEOUT_MS || 7000),
    fetchAllowlist: (process.env.AI_WEB_FETCH_ALLOWLIST || '*')
      .split(',')
      .map(domain => domain.trim().toLowerCase())
      .filter(Boolean),
    fetchPerTenantPerMinute: Number(process.env.AI_FETCH_PER_TENANT_PER_MINUTE || 10)
  },
  tenancy: {
    defaultTenantId: process.env.DEFAULT_TENANT_ID || 'main'
  },
  security: {
    piiMaskFields: (process.env.PII_MASK_FIELDS || 'email,phone,ssn').split(',').map(f => f.trim()).filter(Boolean)
  }
};
