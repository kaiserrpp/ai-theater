const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../server/admin-session');
const shared = require('../api/shared-script/_shared');
const login = require('../api/shared-script/song-auth');
const previous = Object.fromEntries(['SONG_ADMIN_PASSWORD', 'BLOB_READ_WRITE_TOKEN', 'ADMIN_SESSION_SECRET', 'VERCEL_ENV', 'SHARED_STORAGE_NAMESPACE'].map((key) => [key, process.env[key]]));
before(() => {
  process.env.SONG_ADMIN_PASSWORD = 'test-admin-only';
  process.env.BLOB_READ_WRITE_TOKEN = 'test-only-server-secret';
  delete process.env.ADMIN_SESSION_SECRET;
  process.env.VERCEL_ENV = 'production';
  process.env.SHARED_STORAGE_NAMESPACE = 'production';
});
after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const request = (method = 'POST', body = {}, headers = {}, query = {}) => ({ method, body, query,
  headers: { host: 'theatre.example', origin: 'https://theatre.example', 'x-forwarded-proto': 'https', 'sec-fetch-site': 'same-origin', 'x-ai-theatre-admin': '1', ...headers } });
const response = () => ({ statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
  setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, json(body) { this.body = body; return this; } });
const call = async (handler, req) => { const res = response(); await handler(req, res); return res; };
const cookieOf = (res) => res.headers['set-cookie'].split(';')[0];
const signIn = (remember = true) => call(login, request('POST', { password: 'test-admin-only', remember }));

test('a correct password issues a host-only, signed HttpOnly cookie with a 90-day lifetime and no password in the response', async () => {
  const res = await signIn();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.authenticated, true);
  assert.equal(res.body.remembered, true);
  assert.match(res.headers['set-cookie'], /^__Host-ai_theatre_admin=/);
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=7776000']) assert.ok(res.headers['set-cookie'].includes(attribute));
  assert.ok(!res.headers['set-cookie'].includes('Domain='));
  assert.ok(!res.headers['set-cookie'].includes('test-admin-only'));
  assert.ok(!JSON.stringify(res.body).includes('test-admin-only'));
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.ok(res.body.expiresAt > Date.now() + 89 * 86400000);
  const restored = await call(login, request('GET', undefined, { cookie: cookieOf(res) }));
  assert.equal(restored.body.authenticated, true);
  assert.equal(restored.body.expiresAt, res.body.expiresAt);
  const modulePath = require.resolve('../server/admin-session'); delete require.cache[modulePath];
  assert.ok(require(modulePath).readAdminSession(request('GET', {}, { cookie: cookieOf(res) }), 'production'));
});

test('bad or missing passwords never issue a cookie; login remains compatible with the previous client', async () => {
  for (const password of ['', 'wrong', true, { authenticated: true }]) {
    const res = await call(login, request('POST', { password }));
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['set-cookie'], undefined);
  }
  const legacy = request('POST', { password: 'test-admin-only' });
  delete legacy.headers['x-ai-theatre-admin'];
  assert.equal((await call(login, legacy)).statusCode, 200);
  for (const body of [[], 'null', { password: 'test-admin-only', remember: 'yes' }]) {
    assert.equal((await call(login, request('POST', body))).statusCode, 400);
  }
});

test('not remembering produces a browser-session cookie and an eight-hour server limit', async () => {
  const res = await signIn(false);
  assert.equal(res.body.remembered, false);
  assert.ok(!res.headers['set-cookie'].includes('Max-Age='));
  assert.ok(!res.headers['set-cookie'].includes('Expires='));
  assert.ok(res.body.expiresAt <= Date.now() + 8 * 3600000);
});

test('tampering, duplicate cookies, missing cookies and frontend flags cannot grant administrator access', async () => {
  const valid = cookieOf(await signIn());
  const [name, token] = valid.split('=');
  const [payload, signature] = token.split('.');
  const changed = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), exp: 9999999999 })).toString('base64url');
  // Change a signed byte: replacing the last Base64 characters can leave
  // the decoded signature identical when only unused padding bits change.
  const changedSignature = Buffer.from(signature, 'base64url');
  changedSignature[0] ^= 1;
  for (const cookie of ['', `${name}=bad`, `${name}=${changed}.${signature}`, `${valid}; ${valid}`, `${name}=${payload}.${changedSignature.toString('base64url')}`]) {
    assert.equal(auth.readAdminSession(request('GET', {}, { cookie }), 'production'), null);
    assert.equal(shared.isAuthorizedSongAdminRequest(request('POST', { authenticated: true }, { cookie })), false);
  }
  assert.equal(shared.isAuthorizedSongAdminRequest(request('POST', { isAdmin: true }), '__admin_session__'), false);
});

test('server expiry, a password change, a signing-secret change, a different environment and a different host reject remembered access', async () => {
  const signed = await signIn(), cookie = cookieOf(signed);
  const req = request('GET', {}, { cookie });
  assert.ok(auth.readAdminSession(req, 'production'));
  assert.equal(auth.readAdminSession(req, 'preview'), null);
  assert.equal(auth.readAdminSession(request('GET', {}, { cookie, host: 'other.example', origin: 'https://other.example' }), 'production'), null);
  const oldNow = Date.now;
  Date.now = () => signed.body.expiresAt + 1;
  try { assert.equal(auth.readAdminSession(req, 'production'), null); } finally { Date.now = oldNow; }
  process.env.SONG_ADMIN_PASSWORD = 'changed';
  try { assert.equal(auth.readAdminSession(req, 'production'), null); } finally { process.env.SONG_ADMIN_PASSWORD = 'test-admin-only'; }
  process.env.BLOB_READ_WRITE_TOKEN = 'rotated-secret';
  try { assert.equal(auth.readAdminSession(req, 'production'), null); } finally { process.env.BLOB_READ_WRITE_TOKEN = 'test-only-server-secret'; }
});

test('cookie-authorized writes require the app header and reject cross-origin and sibling-origin requests', async () => {
  const cookie = cookieOf(await signIn());
  const correct = request('POST', {}, { cookie });
  assert.equal(shared.isAuthorizedSongAdminRequest(correct), true);
  delete correct.headers['x-ai-theatre-admin'];
  assert.equal(shared.isAuthorizedSongAdminRequest(correct), false);
  for (const headers of [{ origin: 'https://evil.example' }, { origin: 'https://sibling.theatre.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
    assert.equal(shared.isAuthorizedSongAdminRequest(request('POST', {}, { cookie, ...headers })), false);
    assert.equal((await call(login, request('POST', { password: 'test-admin-only' }, headers))).statusCode, 403);
  }
  assert.equal(shared.isAuthorizedSongAdminRequest({ method: 'POST', headers: {} }, 'test-admin-only'), true);
});

test('logout clears the cookie and a following launch without it is signed out', async () => {
  const cookie = cookieOf(await signIn());
  const res = await call(login, request('DELETE', {}, { cookie }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.authenticated, false);
  assert.match(res.headers['set-cookie'], /Max-Age=0/);
  const denied = await call(login, request('GET'));
  assert.deepEqual(denied.body, { authenticated: false });
  const noHeader = request('DELETE', {}, { cookie }); delete noHeader.headers['x-ai-theatre-admin'];
  assert.equal((await call(login, noHeader)).statusCode, 403);
});

test('all protected material endpoints accept a valid session without a password and reject missing, forged or cross-origin authorization before storage writes', async () => {
  const cookie = cookieOf(await signIn());
  const cases = [
    ['publish', ['POST']], ['song-audio', ['POST', 'PATCH', 'DELETE']], ['musical-number', ['POST', 'PATCH', 'DELETE']],
    ['musical-number-audio', ['POST', 'PATCH', 'DELETE']], ['video-audio-extract', ['POST']],
    ['audition-scene', ['POST', 'PATCH', 'DELETE']], ['audition-scene', ['POST', 'PATCH', 'DELETE'], { auditionType: 'music' }],
    ['index', ['POST', 'DELETE'], { resource: 'appearance' }],
  ];
  for (const [name, methods, query = {}] of cases) {
    const handler = require(`../api/shared-script/${name}`);
    for (const method of methods) {
      assert.equal((await call(handler, request(method, {}, { cookie }, query))).statusCode, 400, `${name} ${method} with cookie`);
      assert.equal((await call(handler, request(method, { authenticated: true }, {}, query))).statusCode, 401, `${name} ${method} without cookie`);
      assert.equal((await call(handler, request(method, {}, { cookie, origin: 'https://evil.example' }, query))).statusCode, 401, `${name} ${method} cross-site`);
    }
  }
  const feedback = require('../api/shared-script/intelligent-feedback');
  assert.equal((await call(feedback, request('GET', {}, { cookie }, { pathname: 'outside.json' }))).statusCode, 400);
  assert.equal((await call(feedback, request('GET', {}, {}, { pathname: 'outside.json' }))).statusCode, 401);
});

test('upload authorization validates the session before issuing a media token, with no password header required', async () => {
  const clientPath = require.resolve('@vercel/blob/client');
  const client = require(clientPath), original = require.cache[clientPath].exports;
  let grants = 0;
  require.cache[clientPath].exports = { ...client, handleUpload: async (options) => {
    await options.onBeforeGenerateToken('audio.mp3', '{}'); grants++;
    return { clientToken: 'test-media-token' };
  } };
  const handlerPath = require.resolve('../api/shared-script/song-upload'); delete require.cache[handlerPath];
  const handler = require(handlerPath); require.cache[clientPath].exports = original;
  const cookie = cookieOf(await signIn());
  assert.equal((await call(handler, request('POST', {}, { cookie }))).statusCode, 200);
  assert.equal(grants, 1);
  assert.equal((await call(handler, request('POST', {}))).statusCode, 401);
  assert.equal(grants, 1);
});
