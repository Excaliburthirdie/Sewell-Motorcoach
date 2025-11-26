module.exports = {
  env: process.env.NODE_ENV || 'development',
  server: {
    port: Number(process.env.PORT || 3000),
    enforceHttps: process.env.ENFORCE_HTTPS === 'true',
    hstsMaxAgeSeconds: Number(process.env.HSTS_MAX_AGE_SECONDS || 31536000)
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
  tenancy: {
    defaultTenantId: process.env.DEFAULT_TENANT_ID || 'main'
  },
  pii: {
    maskLogs: process.env.PII_MASK_LOGS !== 'false',
    maskExports: process.env.PII_MASK_EXPORTS === 'true',
    replacement: process.env.PII_MASK_REPLACEMENT || '*',
    sensitiveKeys: (process.env.PII_SENSITIVE_KEYS || 'email,phone,name,message,subject,address,vin')
      .split(',')
      .map(key => key.trim().toLowerCase())
      .filter(Boolean)
  },
  cookies: {
    secure: process.env.COOKIE_SECURE === 'true' || process.env.ENFORCE_HTTPS === 'true',
    sameSite: (process.env.COOKIE_SAMESITE || 'lax').toLowerCase(),
    domain: process.env.COOKIE_DOMAIN,
    path: process.env.COOKIE_PATH || '/'
  },
  retention: {
    leadsDays: Number(process.env.RETENTION_LEADS_DAYS || 365),
    auditLogDays: Number(process.env.RETENTION_AUDIT_DAYS || 90),
    intervalHours: Number(process.env.RETENTION_INTERVAL_HOURS || 24)
  }
};
