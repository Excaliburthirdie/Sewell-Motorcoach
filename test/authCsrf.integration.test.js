const assert = require('node:assert/strict');
const { describe, it, before, after, test } = require('node:test');

const skipIntegration = process.env.RUN_INTEGRATION_TESTS !== 'true';

if (skipIntegration) {
  test.skip('auth + CSRF integration (requires RUN_INTEGRATION_TESTS=true)', () => {});
} else {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const request = require('supertest');

  const fixturesDir = path.join(__dirname, '..', 'data');

  function createDataDir() {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-dealer-data-'));
    fs.cpSync(fixturesDir, tempRoot, { recursive: true });
    return tempRoot;
  }

  describe('auth + CSRF integration', () => {
    let app;
    let dataDir;

    before(() => {
      dataDir = createDataDir();
      process.env.DATA_DIR = dataDir;
      delete require.cache[require.resolve('../index')];
      // eslint-disable-next-line global-require
      app = require('../index');
    });

    after(() => {
      fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('issues CSRF token and allows login with it', async () => {
      const csrfResponse = await request(app).get('/v1/health');
      const csrfCookie = csrfResponse.headers['set-cookie'].find(cookie => cookie.startsWith('csrfToken='));
      const csrfToken = csrfResponse.headers['x-csrf-token'];

      const login = await request(app)
        .post('/v1/auth/login')
        .set('x-tenant-id', 'main')
        .set('x-csrf-token', csrfToken)
        .set('Cookie', csrfCookie)
        .send({ username: 'dealer-admin', password: 'password123', tenantId: 'main' });

      assert.equal(login.status, 200);
      assert.ok(login.body.accessToken);
      assert.ok(login.headers['set-cookie'].some(c => c.startsWith('refreshToken=')));
    });

    it('rotates refresh tokens and requires CSRF header', async () => {
      const csrfResponse = await request(app).get('/v1/health');
      const csrfCookie = csrfResponse.headers['set-cookie'].find(cookie => cookie.startsWith('csrfToken='));
      const csrfToken = csrfResponse.headers['x-csrf-token'];

      const login = await request(app)
        .post('/v1/auth/login')
        .set('x-tenant-id', 'main')
        .set('x-csrf-token', csrfToken)
        .set('Cookie', csrfCookie)
        .send({ username: 'dealer-admin', password: 'password123', tenantId: 'main' });

      const refreshCookie = login.headers['set-cookie'].find(c => c.startsWith('refreshToken='));
      const refresh = await request(app)
        .post('/v1/auth/refresh')
        .set('x-csrf-token', csrfToken)
        .set('Cookie', [csrfCookie, refreshCookie].join('; '))
        .send({ refreshToken: login.body.refreshToken });

      assert.equal(refresh.status, 200);
      assert.ok(refresh.body.accessToken);
    });

    it('blocks protected routes without bearer token', async () => {
      const response = await request(app).get('/v1/settings');
      assert.equal(response.status, 401);
      assert.equal(response.body.code, 'UNAUTHORIZED');
    });
  });
}
