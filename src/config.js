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
  }
};
