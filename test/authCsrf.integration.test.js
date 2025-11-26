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

  beforeAll(() => {
    dataDir = createDataDir();
    process.env.DATA_DIR = dataDir;
    jest.resetModules();
    // eslint-disable-next-line global-require
    app = require('../index');
  });

  afterAll(() => {
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

    expect(login.status).toBe(200);
    expect(login.body.accessToken).toBeDefined();
    expect(login.headers['set-cookie'].some(c => c.startsWith('refreshToken='))).toBe(true);
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

    expect(refresh.status).toBe(200);
    expect(refresh.body.accessToken).toBeDefined();
  });

  it('blocks protected routes without bearer token', async () => {
    const response = await request(app).get('/v1/settings');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHORIZED');
  });
});
