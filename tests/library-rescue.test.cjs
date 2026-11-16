const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const snapshot = require('../server/library-rescue.json');
const rescue = require('../server/library-rescue');
const shared = require('../api/shared-script/_shared');

const protectedMode = async action => {
  const previous = Object.fromEntries(['VERCEL', 'VERCEL_ENV', 'SHARED_STORAGE_NAMESPACE', 'LIBRARY_STORAGE_MODE', 'BLOB_READ_WRITE_TOKEN'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { VERCEL: '1', VERCEL_ENV: 'production', BLOB_READ_WRITE_TOKEN: 'test-only' });
  delete process.env.SHARED_STORAGE_NAMESPACE; delete process.env.LIBRARY_STORAGE_MODE;
  try { await action(); } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
};
const call = async (handler, request) => {
  const result = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; }, json(body) { this.body = body; } };
  await handler(request, result); return result;
};

test('the published rescue contains every referenced asset, with verified original bytes and a complete warmup', () => {
  assert.equal(snapshot.namespace, 'production');
  const referenced = new Set();
  const visit = value => {
    if (typeof value === 'string' && value.startsWith('https://ai-theater.vercel.app/library/production/')) referenced.add(value.split('/').pop());
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(snapshot.works);
  assert.equal(referenced.size, 372);
  for (const asset of snapshot.assets) {
    assert.ok(referenced.has(asset.file));
    const bytes = fs.readFileSync(path.join(__dirname, '../public/library/production', asset.file));
    assert.equal(bytes.length, asset.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  }
  const work = snapshot.works.d92b33981047;
  assert.equal(work.manifest.musicalNumbers.length, 9);
  assert.equal(work.manifest.musicalAuditions.length, 8);
  assert.equal(require('../shared/warmupCatalog').validateWarmupCatalog(work.warmup), null);
  assert.equal(work.warmup.exercises.length, 8);
  assert.equal(JSON.stringify(snapshot.works).includes('.blob.vercel-storage.com'), false);
});

test('production can open the work, appearance, catalogue and all warmups without calling Blob', async () => protectedMode(async () => {
  // An unusable token means any accidental real Blob call would fail this test.
  const list = await shared.listSharedScriptSummaries();
  assert.equal(list.length, 1); assert.equal(list[0].musicalNumberCount, 9);
  const manifest = await shared.readManifest(list[0].shareId);
  assert.equal(manifest.scriptData.obra, 'In The Heights');
  assert.ok(manifest.appearance.background.uri.startsWith('https://ai-theater.vercel.app/library/production/'));
  const handler = require('../api/shared-script/index');
  const result = await call(handler, { method: 'GET', query: { resource: 'warmup', shareId: manifest.shareId } });
  assert.equal(result.statusCode, 200); assert.equal(result.body.catalog.exercises.length, 8);
  const appearance = await call(handler, { method: 'GET', query: { resource: 'appearance', shareId: manifest.shareId } });
  assert.equal(appearance.statusCode, 200); assert.deepEqual(appearance.body, manifest.appearance);
  await assert.rejects(shared.readManifest('unknown-work'), /not found/);
  await assert.rejects(shared.writeManifest(manifest), /temporalmente protegidos/);
  const context = await call(require('../api/shared-script/storage-context'), { method: 'GET' });
  assert.equal(context.body.readOnly, true);
}));

test('rescue data cannot leak into preview/development or be changed by a response consumer', async () => protectedMode(async () => {
  assert.equal(rescue.getProtectedLibrary('preview'), null);
  assert.equal(rescue.getProtectedLibrary('development'), null);
  assert.doesNotThrow(() => rescue.assertStorageWritable('preview'));
  const first = rescue.getProtectedLibrary('production'); first.works.d92b33981047.manifest.scriptData.obra = 'Changed';
  assert.equal(rescue.getProtectedLibrary('production').works.d92b33981047.manifest.scriptData.obra, 'In The Heights');
}));
