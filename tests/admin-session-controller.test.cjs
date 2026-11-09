const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createAdminSessionController } = require('../src/utils/adminSessionController.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader; else delete require.extensions['.ts'];
const active = () => ({ authenticated: true, remembered: true, expiresAt: Date.now() + 90 * 86400000 });

test('entering the password once restores access on later launches using only the server cookie', async () => {
  const requests = [];
  let cookie = false;
  const transport = async (method, body) => { requests.push({ method, body }); if (method === 'POST') cookie = true; return cookie ? active() : { authenticated: false }; };
  const first = createAdminSessionController(transport);
  await first.restore(); assert.equal(first.getSnapshot().status, 'signed-out');
  await first.signIn('one-time-secret', true);
  assert.equal(first.getSnapshot().status, 'authenticated');
  assert.equal(JSON.stringify(first.getSnapshot()).includes('one-time-secret'), false);
  const fresh = createAdminSessionController(transport);
  await Promise.all([fresh.restore(), fresh.restore()]);
  assert.equal(fresh.getSnapshot().status, 'authenticated');
  assert.equal(requests.filter((item) => item.method === 'POST').length, 1);
  assert.ok(requests.filter((item) => item.method === 'GET').every((item) => item.body === undefined));
});

test('a wrong password and a browser that rejects the cookie never open administration', async () => {
  const wrong = createAdminSessionController(async () => { throw new Error('Clave incorrecta'); });
  await assert.rejects(wrong.signIn('wrong'), /Clave incorrecta/);
  assert.equal(wrong.getSnapshot().status, 'signed-out');
  const blocked = createAdminSessionController(async (method) => method === 'POST' ? active() : { authenticated: false });
  await assert.rejects(blocked.signIn('correct'), /no ha conservado la sesión/);
  assert.equal(blocked.getSnapshot().status, 'signed-out');
});

test('remembering can be disabled and a server-expired session returns to sign-in', async () => {
  let lastBody, expired = false;
  const session = createAdminSessionController(async (method, body) => { if (method === 'POST') lastBody = body; return expired ? { authenticated: false } : { ...active(), remembered: false }; });
  await session.signIn('correct', false);
  assert.equal(lastBody.remember, false);
  assert.equal(session.getSnapshot().remembered, false);
  expired = true; await session.restore();
  assert.equal(session.getSnapshot().status, 'signed-out');
});

test('a delayed startup response cannot restore access after logout or an unauthorized write', async () => {
  for (const action of ['logout', 'unauthorized']) {
    let resolve;
    const session = createAdminSessionController((method) => method === 'GET' ? new Promise((done) => { resolve = done; }) : Promise.resolve({ authenticated: false }));
    const startup = session.restore();
    if (action === 'logout') await session.signOut(); else session.invalidate();
    resolve(active()); await startup;
    assert.equal(session.getSnapshot().status, 'signed-out');
  }
});

test('network failure offers a retry instead of pretending the password is wrong', async () => {
  let online = false;
  const session = createAdminSessionController(async () => { if (!online) throw new Error('offline'); return active(); });
  await session.restore();
  assert.equal(session.getSnapshot().status, 'unavailable');
  assert.match(session.getSnapshot().error, /conexión/);
  online = true; await session.restore();
  assert.equal(session.getSnapshot().status, 'authenticated');
});

test('logout waits for confirmed cookie removal and reports a network failure without claiming success', async () => {
  let failing = false;
  const session = createAdminSessionController(async (method) => { if (method === 'DELETE' && failing) throw new Error('offline'); return method === 'DELETE' ? { authenticated: false } : active(); });
  await session.restore(); failing = true;
  await assert.rejects(session.signOut(), /offline/);
  assert.equal(session.getSnapshot().status, 'authenticated');
  failing = false; await session.signOut();
  assert.equal(session.getSnapshot().status, 'signed-out');
});
