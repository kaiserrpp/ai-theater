const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createSharedAppearanceSession: session } = require('../src/utils/sharedAppearanceSession.ts');
const { parseBackgroundPreference } = require('../src/utils/appearance.ts');
const { resolveWorkBackground } = require('../src/store/workAppearances.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];
const { normalizeSharedAppearance } = require('../shared/workAppearance');
const sharedPath = require.resolve('../api/shared-script/_shared');
const shared = require(sharedPath);
const blobPath = require.resolve('@vercel/blob');
require(blobPath);
const previousEnv = Object.fromEntries(['BLOB_READ_WRITE_TOKEN', 'SHARED_STORAGE_NAMESPACE', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_REF'].map((key) => [key, process.env[key]]));
before(() => { process.env.BLOB_READ_WRITE_TOKEN = 'test-only'; delete process.env.SHARED_STORAGE_NAMESPACE; delete process.env.VERCEL_GIT_COMMIT_REF; });
after(() => { for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
const local = { uri: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=', name: 'Cartel.png', average: [30, 80, 150], accent: [20, 100, 210] };
const remote = (name = 'poster') => ({ ...local, name, uri: `https://test.public.blob.vercel-storage.com/shared-scripts/production/work/appearance/${name}.png` });
const empty = () => normalizeSharedAppearance(undefined);
const appearance = (revision, background = remote()) => ({ revision, background, updatedAt: '2026-11-11T17:00:00Z' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

const api = (onUpload = () => {}) => {
  let manifest = shared.normalizeManifest({ shareId: 'work', scriptData: { obra: 'Obra', personajes: [], guion: [] },
    auditionScenes: [{ id: 'scene', title: 'Escena', scriptData: { obra: 'Escena', personajes: ['ANA'], guion: [{ p: 'ANA', t: 'Hola.' }] } }] });
  const uploads = []; let reads = 0, writes = 0;
  const originalShared = require.cache[sharedPath], originalBlob = require.cache[blobPath];
  require.cache[sharedPath] = { ...originalShared, exports: { ...shared,
    hasSongAdminPasswordConfigured: () => true,
    isAuthorizedSongAdminRequest: (_request, password) => password === 'admin-test',
    readManifest: async () => { reads++; return structuredClone(manifest); },
    writeManifest: async (value) => { writes++; manifest = shared.normalizeManifest(value); return structuredClone(manifest); },
  } };
  require.cache[blobPath] = { ...originalBlob, exports: { ...originalBlob.exports, put: async (pathname, bytes, options) => {
    uploads.push({ pathname, bytes, options }); onUpload(manifest);
    return { url: `https://test.public.blob.vercel-storage.com/${pathname}` };
  } } };
  const appearanceHandlerPath = require.resolve('../server/work-appearance'); delete require.cache[appearanceHandlerPath];
  const appearancePath = require.resolve('../api/shared-script/index'); delete require.cache[appearancePath];
  const publishPath = require.resolve('../api/shared-script/publish'); delete require.cache[publishPath];
  const handler = require(appearancePath), publish = require(publishPath);
  require.cache[sharedPath] = originalShared; require.cache[blobPath] = originalBlob;
  const request = async (method, body = {}, authorized = true, selectedHandler = handler) => {
    const response = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
      setHeader(key, value) { this.headers[key] = value; }, json(value) { this.body = value; return this; } };
    await selectedHandler({ method, body: { ...body, ...(authorized ? { password: 'admin-test' } : {}) }, query: { ...body, resource: 'appearance' },
      headers: { host: 'localhost' } }, response);
    return response;
  };
  return { request, publish, uploads, manifest: () => manifest, reads: () => reads, writes: () => writes };
};
const input = (revision = 0) => ({ shareId: 'work', revision, background: { ...local, dataUrl: local.uri } });

test('sharing an image makes the same picture and palette readable without administration on a second device', async () => {
  const f = api(); const original = structuredClone(f.manifest().auditionScenes);
  const saved = await f.request('POST', input());
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.body.revision, 1);
  assert.deepEqual(saved.body.background.average, local.average);
  assert.deepEqual(saved.body.background.accent, local.accent);
  assert.ok(saved.body.background.uri.startsWith('https://test.public.blob.vercel-storage.com/'));
  assert.deepEqual((await f.request('GET', { shareId: 'work' }, false)).body, saved.body);
  assert.deepEqual(f.manifest().auditionScenes, original);
  assert.deepEqual(parseBackgroundPreference(JSON.stringify(saved.body.background)), saved.body.background);
});

test('removal is shared and survives republishing the work from an older client', async () => {
  const f = api(); await f.request('POST', input());
  const removed = await f.request('DELETE', { shareId: 'work', revision: 1 });
  assert.equal(removed.body.revision, 2); assert.equal(removed.body.background, null);
  const published = await f.request('POST', { shareId: 'work', fileName: 'Obra', scriptData: f.manifest().scriptData }, true, f.publish);
  assert.equal(published.statusCode, 200);
  assert.deepEqual(published.body.manifest.appearance, removed.body);
  assert.deepEqual((await f.request('GET', { shareId: 'work' }, false)).body, removed.body);
});

test('authentication, revisions, valid images and metadata are checked before uploading', async () => {
  const f = api();
  for (const method of ['POST', 'DELETE']) assert.equal((await f.request(method, input(), false)).statusCode, 401);
  assert.equal(f.reads(), 0);
  for (const bad of [
    { ...input(), revision: 9 },
    { ...input(), shareId: '../other' },
    { ...input(), background: { ...input().background, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' } },
    { ...input(), background: { ...input().background, dataUrl: 'data:image/jpeg;base64,AA==' } },
    { ...input(), background: { ...input().background, dataUrl: remote().uri } },
    { ...input(), background: { ...input().background, average: [300, 0, 0] } },
    { ...input(), background: { ...input().background, accent: ['bad', 0, 0] } },
  ]) assert.ok((await f.request('POST', bad)).statusCode >= 400);
  assert.equal(f.uploads.length, 0); assert.equal(f.writes(), 0);
  await f.request('POST', input());
  assert.equal((await f.request('POST', input())).statusCode, 409);
  assert.equal(f.uploads.length, 1);
});

test('new images keep their storage environment and cannot erase materials edited during upload', async () => {
  for (const namespace of ['production', 'preview', 'development']) {
    process.env.VERCEL_ENV = namespace;
    const f = api((manifest) => { manifest.scriptData.obra = 'Título actualizado durante la subida'; });
    assert.equal((await f.request('POST', input())).statusCode, 200);
    assert.ok(f.uploads[0].pathname.startsWith(`shared-scripts/${namespace}/work/appearance/`));
    assert.equal(f.uploads[0].options.contentType, 'image/png');
    assert.equal(f.manifest().scriptData.obra, 'Título actualizado durante la subida');
  }
});

test('the existing local poster migrates once, then a fresh device reads the same shared image', async () => {
  let stored = empty(), writes = 0;
  const deps = { read: async () => stored, write: async (background, revision) => {
    assert.equal(revision, stored.revision); writes++; stored = appearance(revision + 1, background ? { ...background, uri: remote().uri } : null); return stored;
  } };
  const first = session(deps);
  await Promise.all([first.refresh(true, local), first.refresh(true, local)]);
  await first.refresh(true, local);
  assert.equal(writes, 1);
  const other = session(deps); await other.refresh(false);
  assert.deepEqual(other.getSnapshot().appearance, first.getSnapshot().appearance);
  await first.save(null); await other.refresh(true, local);
  assert.equal(other.getSnapshot().appearance.background, null);
  assert.equal(writes, 2, 'an old local poster cannot undo the shared removal');
});

test('read-only devices never migrate private copies; a conflict adopts the image chosen elsewhere', async () => {
  let writes = 0;
  const readOnly = session({ read: async () => empty(), write: async () => { writes++; throw new Error('unexpected'); } });
  await readOnly.refresh(false, local); assert.equal(writes, 0);
  let reads = 0;
  const migrating = session({ read: async () => ++reads === 1 ? empty() : appearance(1, remote('other')),
    write: async () => { throw Object.assign(new Error('conflict'), { status: 409 }); } });
  await migrating.refresh(true, local);
  assert.equal(migrating.getSnapshot().appearance.background.name, 'other');
  assert.equal(migrating.getSnapshot().notice, '');
});

test('late refreshes cannot undo a save or leak into another work', async () => {
  const stale = deferred();
  const a = session({ initial: appearance(1), read: () => stale.promise,
    write: async () => appearance(2, remote('new')) });
  const pending = a.refresh(); await a.save(local);
  const b = session({ initial: appearance(4, remote('work-b')), read: async () => appearance(4, remote('work-b')),
    write: async () => { throw new Error('unexpected'); } });
  stale.resolve(appearance(1, remote('old'))); await pending;
  assert.equal(a.getSnapshot().appearance.background.name, 'new');
  assert.equal(b.getSnapshot().appearance.background.name, 'work-b');
});

test('failed migration keeps its local image and actionable notice until retry succeeds', async () => {
  let fail = true, writes = 0;
  const f = session({ read: async () => empty(), write: async () => {
    writes++; if (fail) throw new Error('sin conexión'); return appearance(1);
  } });
  await f.refresh(true, local);
  assert.equal(f.getSnapshot().appearance.revision, 0);
  assert.equal(f.getSnapshot().notice, 'sin conexión');
  await f.refresh(true, local);
  assert.equal(writes, 1); assert.equal(f.getSnapshot().notice, 'sin conexión');
  fail = false; await f.retry(true, local);
  assert.equal(writes, 2); assert.equal(f.getSnapshot().notice, '');
});

test('publishing a local work keeps its own image until migration, respecting an explicit shared reset', () => {
  const works = { 'local:a': local, 'local:b': remote('other'), 'shared:reset': null };
  assert.deepEqual(resolveWorkBackground(works, 'shared:new', 'local:a'), local);
  assert.equal(resolveWorkBackground(works, 'shared:reset', 'local:a'), null);
  assert.equal(resolveWorkBackground(works, 'shared:new', 'local:missing'), null);
  assert.equal(resolveWorkBackground(works, null, 'local:a'), null);
});

test('signing in while the shared image loads can migrate immediately without another polling interval', async () => {
  const pending = deferred(); let writes = 0;
  const f = session({ read: () => pending.promise, write: async () => { writes++; return appearance(1); } });
  const readOnly = f.refresh(false, local);
  const authorized = f.refresh(true, local);
  pending.resolve(empty()); await Promise.all([readOnly, authorized]);
  assert.equal(writes, 1);
});

test('an image changed on another device during upload is never overwritten', async () => {
  const f = api((manifest) => { manifest.appearance = appearance(1, remote('other')); });
  assert.equal((await f.request('POST', input())).statusCode, 409);
  assert.equal(f.manifest().appearance.background.name, 'other');
  assert.equal(f.writes(), 0);
});

test('the historical preview branch also keeps its new images outside production', async () => {
  process.env.VERCEL_ENV = 'preview'; process.env.VERCEL_GIT_COMMIT_REF = 'codex/intelligent-line-advance';
  try {
    const f = api(); assert.equal((await f.request('POST', input())).statusCode, 200);
    assert.ok(f.uploads[0].pathname.startsWith('shared-scripts/preview/'));
  } finally { delete process.env.VERCEL_GIT_COMMIT_REF; }
});
