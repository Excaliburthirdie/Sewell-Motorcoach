const crypto = require('crypto');
const { randomUUID } = require('node:crypto');
const { sign, verify } = require('./jwt');
const { datasets, persist } = require('./state');
const { matchesTenant, normalizeTenantId } = require('./tenantService');
const config = require('../config');

const JWT_SECRET = config.auth.jwtSecret;
const ACCESS_TOKEN_TTL_SECONDS = config.auth.accessTokenTtlSeconds;
const REFRESH_TOKEN_TTL_SECONDS = config.auth.refreshTokenTtlSeconds;
const DEFAULT_SALT = config.auth.passwordSalt;

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(`${salt}${password}`).digest('hex');
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, salt, ...safe } = user;
  return safe;
}

function findUser(username, tenantId) {
  const tenant = normalizeTenantId(tenantId);
  return datasets.users.find(
    u => u.username.toLowerCase() === username.toLowerCase() && matchesTenant(u.tenantId, tenant)
  );
}

function validatePassword(user, password) {
  const salt = user.salt || DEFAULT_SALT;
  return hashPassword(password, salt) === user.passwordHash;
}

function generateTokens(user, rotatedFrom) {
  const accessToken = sign(
    { sub: user.id, username: user.username, role: user.role, tenantId: user.tenantId, type: 'access' },
    JWT_SECRET,
    { expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS }
  );
  const jti = randomUUID();
  const refreshToken = sign({ sub: user.id, type: 'refresh', jti, tenantId: user.tenantId }, JWT_SECRET, {
    expiresInSeconds: REFRESH_TOKEN_TTL_SECONDS
  });
  const record = {
    jti,
    userId: user.id,
    tenantId: user.tenantId,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
    rotatedFrom: rotatedFrom || null
  };
  datasets.refreshTokens.push(record);
  persist.refreshTokens(datasets.refreshTokens);
  return { accessToken, refreshToken };
}

function recordRevocation(jti, reason) {
  const entry = {
    jti,
    reason,
    revokedAt: new Date().toISOString()
  };
  datasets.revokedRefreshTokens.push(entry);
  persist.revokedRefreshTokens(datasets.revokedRefreshTokens);
  return entry;
}

function authenticate(username, password, tenantId) {
  const user = findUser(username, tenantId);
  if (!user || !validatePassword(user, password)) {
    return null;
  }
  const tokens = generateTokens(user);
  return { user: sanitizeUser(user), tokens };
}

function verifyAccessToken(token) {
  const payload = verify(token, JWT_SECRET);
  if (payload.type !== 'access') {
    throw new Error('Invalid access token type');
  }
  return payload;
}

function verifyRefreshToken(token) {
  const payload = verify(token, JWT_SECRET);
  if (payload.type !== 'refresh') {
    throw new Error('Invalid refresh token type');
  }
  if (datasets.revokedRefreshTokens.find(entry => entry.jti === payload.jti)) {
    throw new Error('Refresh token has been revoked');
  }
  const record = datasets.refreshTokens.find(entry => entry.jti === payload.jti);
  if (!record) {
    recordRevocation(payload.jti, 'reused_or_unknown');
    throw new Error('Refresh token has been rotated or revoked');
  }
  const expiresAt = new Date(record.expiresAt).getTime();
  if (Date.now() > expiresAt) {
    throw new Error('Refresh token expired');
  }
  const user = datasets.users.find(u => u.id === record.userId);
  if (!user) {
    throw new Error('User no longer exists');
  }
  return { payload, user, record };
}

function rotateRefresh(refreshToken) {
  const { payload, user, record } = verifyRefreshToken(refreshToken);
  if (!matchesTenant(payload.tenantId, user.tenantId)) {
    throw new Error('Refresh token tenant mismatch');
  }
  recordRevocation(record.jti, 'rotated');
  datasets.refreshTokens = datasets.refreshTokens.filter(entry => entry.jti !== record.jti);
  persist.refreshTokens(datasets.refreshTokens);
  const tokens = generateTokens(user, payload.jti);
  return { tokens, user: sanitizeUser(user) };
}

function revokeRefreshToken(refreshToken) {
  const { record } = verifyRefreshToken(refreshToken);
  recordRevocation(record.jti, 'revoked');
  datasets.refreshTokens = datasets.refreshTokens.filter(entry => entry.jti !== record.jti);
  persist.refreshTokens(datasets.refreshTokens);
  return record;
}

module.exports = {
  authenticate,
  generateTokens,
  sanitizeUser,
  rotateRefresh,
  revokeRefreshToken,
  verifyAccessToken,
  DEFAULT_SALT,
  hashPassword
};
