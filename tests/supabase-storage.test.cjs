const { test } = require('node:test');
const assert = require('node:assert/strict');
const storage = require('../server/shared-storage');
const shared = require('../api/shared-script/_shared');
const snapshot = require('../server/library-rescue.json');
const fixture = async action => {
  const keys = ['SHARED_STORAGE_PROVIDER', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'VERCEL', 'VERCEL_ENV', 'SHARED_STORAGE_NAMESPACE', 'SONG_ADMIN_PASSWORD'];
  const previous = Object.fromEntries(keys.map(k => [k, process.env[k]])), oldFetch = global.fetch;
  Object.assign(process.env, { SHARED_STORAGE_PROVIDER: 'supabase', SUPABASE_URL: 'https://fixture.supabase.co',
    SUPABASE_SECRET_KEY: 'test-server-only-key', VERCEL: '1', VERCEL_ENV: 'production', SONG_ADMIN_PASSWORD: 'test-admin' });
  delete process.env.SHARED_STORAGE_NAMESPACE;
  const state = { objects: new Map(), buckets: new Map(), calls: [], fail: false };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  global.fetch = async (input, options = {}) => {
    const url = new URL(String(input)), method = options.method || 'GET';
    assert.equal(url.origin, 'https://fixture.supabase.co', 'alternative must never call Blob or another host');
    const pathname = url.pathname.replace('/storage/v1/', '');
    const body = typeof options.body === 'string' ? options.body : '';
    const headers = new Headers(options.headers);
    assert.equal(headers.get('apikey'), 'test-server-only-key');
    state.calls.push({ pathname, method, body });
    if (state.fail) return json({ message: 'Service unavailable', statusCode: '503' }, 503);
    if (pathname === 'bucket' && method === 'POST') {
      const value = JSON.parse(body); state.buckets.set(value.id, { id: value.id, public: value.public, file_size_limit: value.file_size_limit }); return json(value);
    }
    if (pathname.startsWith('bucket/')) return state.buckets.has(pathname.slice(7)) ? json(state.buckets.get(pathname.slice(7))) : json({ message: 'Missing bucket', statusCode: '404' }, 404);
    if (pathname.startsWith('object/upload/sign/')) return json({ url: '/' + pathname + '?token=path-limited-test-token' });
    if (pathname.startsWith('object/list/')) {
      const query = JSON.parse(body), prefix = query.prefix ? query.prefix + '/' : '', result = new Map();
      for (const [key, text] of state.objects) {
        const root = pathname.slice('object/list/'.length) + '/';
        if (!key.startsWith(root + prefix)) continue;
        const tail = key.slice((root + prefix).length), name = tail.split('/')[0];
        result.set(name, tail.includes('/') ? { name, id: null } : { name, id: key, metadata: { size: text.length }, updated_at: '2026-11-17T00:00:00Z' });
      }
      return json([...result.values()].slice(query.offset, query.offset + query.limit));
    }
    if (pathname.startsWith('object/')) {
      const key = pathname.slice(7);
      if (method === 'POST') { state.objects.set(key, body); return json({ Key: key, Id: 'fixture-object' }); }
      if (state.objects.has(key)) return new Response(state.objects.get(key), { headers: { 'Content-Type': 'application/json' } });
      return json({ message: 'Object not found', statusCode: '404', code: 'NoSuchKey' }, 404);
    }
    throw new Error('Unexpected fixture path: ' + pathname);
  };
  try { await action(state); } finally {
    global.fetch = oldFetch;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
};
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; },
  setHeader() {}, json(body) { this.body = body; return this; } });

test('the official storage SDK saves private metadata and lists works without copying any media or accessing Blob', async () => fixture(async state => {
  const work = structuredClone(snapshot.works.d92b33981047.manifest);
  await shared.writeManifest(work);
  assert.deepEqual(await shared.readManifest(work.shareId), shared.normalizeManifest(work));
  const list = await shared.listSharedScriptSummaries(); assert.equal(list[0].musicalNumberCount, 9);
  assert.equal(state.objects.size, 1);
  assert.ok([...state.objects.keys()][0].startsWith('theatre-data/shared-scripts/production/'));
  assert.ok(state.calls.every(call => !call.pathname.startsWith('object/theatre-media/')));
}));

test('upload grants are restricted to the authorized work, environment, file type and free size limit, without exposing a service key', async () => fixture(async state => {
  const input = { pathname: 'shared-scripts/production/work/musical-numbers/number-one/123-voice.mp3',
    size: 100, contentType: 'audio/mpeg', shareId: 'work', targetId: 'number-one', targetType: 'musical-number' };
  const grant = await storage.createUploadGrant(input, 'production');
  assert.equal(grant.provider, 'supabase'); assert.ok(grant.publicUrl.includes('/theatre-media/'));
  assert.equal(JSON.stringify(grant).includes('test-server-only-key'), false);
  const count = state.calls.length;
  for (const change of [{ pathname: input.pathname.replace('production', 'preview') }, { shareId: 'other' },
    { size: storage.MAX_UPLOAD_BYTES + 1 }, { pathname: input.pathname.replace('123-', '../123-') }, { contentType: 'application/javascript' }]) {
    await assert.rejects(storage.createUploadGrant({ ...input, ...change }, 'production'), /subida no es válida/);
  }
  assert.equal(state.calls.length, count);
  const handler = require('../api/shared-script/song-upload');
  const denied = response(); await handler({ method: 'POST', headers: {}, body: {} }, denied);
  assert.equal(denied.statusCode, 401); assert.equal(state.calls.length, count);
}));

test('a failed alternative read can keep published rehearsal available but cannot become the basis of an edit or retry in Blob', async () => fixture(async state => {
  state.fail = true;
  const work = await shared.readManifest('d92b33981047', { allowPublishedFallback: true });
  assert.equal(work.scriptData.obra, 'In The Heights');
  await assert.rejects(shared.readManifest('d92b33981047'), /almacenamiento alternativo/);
  await assert.rejects(shared.writeManifest(work), /almacenamiento alternativo/);
  assert.equal(require('../server/library-rescue').getPublishedLibrary('preview'), null);
}));

test('provisioning is authenticated and idempotent, keeps JSON private and never overwrites edits on a retry', async () => fixture(async state => {
  const setup = require('../server/storage-setup');
  const denied = response(); await setup({ method: 'POST', headers: {} }, denied);
  assert.equal(denied.statusCode, 401); assert.equal(state.calls.length, 0);
  const req = { method: 'POST', headers: { 'x-song-admin-password': 'test-admin' } };
  const first = response(); await setup(req, first); assert.equal(first.statusCode, 200); assert.equal(first.body.seeded, 2);
  assert.equal(state.buckets.get('theatre-media').public, true); assert.equal(state.buckets.get('theatre-data').public, false);
  const key = 'theatre-data/shared-scripts/production/d92b33981047/manifest.json';
  const changed = JSON.parse(state.objects.get(key)); changed.scriptData.obra = 'Later edit'; state.objects.set(key, JSON.stringify(changed));
  const second = response(); await setup(req, second); assert.equal(second.statusCode, 200); assert.equal(second.body.seeded, 0);
  assert.equal(JSON.parse(state.objects.get(key)).scriptData.obra, 'Later edit'); assert.equal(second.body.mediaFilesCopied, 0);
}));

test('musical-number changes and rehearsal reports use the new private store and retain the original materials', async () => fixture(async state => {
  const work = structuredClone(snapshot.works.d92b33981047.manifest);
  // A separate scriptless work exercises adding the next musical number.
  work.shareId = 'storage-qa'; work.scriptData = { obra: 'Storage QA', personajes: [], guion: [] };
  await shared.writeManifest(work);
  const edit = response();
  await require('../api/shared-script/musical-number')({ method: 'POST', headers: {},
    body: { shareId: work.shareId, title: 'New number', password: 'test-admin' } }, edit);
  assert.equal(edit.statusCode, 200); assert.equal(edit.body.musicalNumbers.length, 10);
  assert.deepEqual(edit.body.musicalAuditions, work.musicalAuditions);
  assert.deepEqual(edit.body.auditionScenes, work.auditionScenes);
  const reportHandler = require('../api/shared-script/intelligent-feedback'), sent = response();
  await reportHandler({ method: 'POST', headers: {}, body: { sessionId: 'test-session', scriptId: 'storage-qa', scriptTitle: 'Storage QA',
    entries: [{ expectedText: 'Hola', heardText: 'Hola', result: 'accepted' }] } }, sent);
  assert.equal(sent.statusCode, 200); assert.equal(sent.body.ok, true);
  const received = response(); await reportHandler({ method: 'GET', headers: { 'x-song-admin-password': 'test-admin' }, query: { scriptId: 'storage-qa' } }, received);
  assert.equal(received.statusCode, 200); assert.equal(received.body.latestReport.entries[0].heardText, 'Hola');
  assert.ok([...state.objects.keys()].some(key => key.startsWith('theatre-data/intelligent-feedback/production/')));
  assert.ok(state.calls.every(call => !call.pathname.includes('object/public/theatre-data')));
}));

test('legacy report migration uses one durable listing, preserves raw reports and never replaces an existing report', async () => fixture(async state => {
  const { migrateFeedbackArchive } = require('../server/feedback-archive');
  const reports = Array.from({ length: 7 }, (_, index) => ({ version: 1, environment: 'production',
    sessionId: `legacy-${index}`, createdAt: '2026-11-15T13:57:00Z', runtime: index % 2 ? 'browser' : 'native_android',
    entries: [{ expectedText: 'Sure', heardText: 'sore', result: 'siguiente_linea', score: 0, language: 'en-US' }] }));
  const blobs = reports.map(report => ({ pathname: `intelligent-feedback/production/work/${report.sessionId}.json`,
    url: `https://fixture.public.blob.vercel-storage.com/intelligent-feedback/production/work/${report.sessionId}.json` }));
  let listings = 0, downloads = 0;
  const existing = { ...reports[1], entries: [{ heardText: 'newer result must survive' }] };
  state.objects.set(`theatre-data/${blobs[1].pathname}`, JSON.stringify(existing));
  const dependencies = {
    listLegacy: async options => { listings++; assert.deepEqual(options, { prefix: 'intelligent-feedback/production/', limit: 1000 }); return { blobs, hasMore: false }; },
    fetchLegacy: async url => { downloads++; return new Response(JSON.stringify(reports[blobs.findIndex(blob => blob.url === url)])); },
  };
  const first = await migrateFeedbackArchive('production', dependencies);
  assert.equal(first.complete, false); assert.equal(first.remainingInPage, 2);
  const second = await migrateFeedbackArchive('production', dependencies);
  assert.equal(second.complete, true); assert.equal(second.copied, 6); assert.equal(second.existing, 1);
  assert.equal(second.originalsDeleted, 0); assert.equal(listings, 1); assert.equal(downloads, 6);
  assert.deepEqual(JSON.parse(state.objects.get(`theatre-data/${blobs[0].pathname}`)), reports[0]);
  assert.deepEqual(JSON.parse(state.objects.get(`theatre-data/${blobs[1].pathname}`)), existing);
  await migrateFeedbackArchive('production', dependencies);
  assert.equal(listings, 1); assert.equal(downloads, 6);
  assert.ok(state.calls.every(call => !call.pathname.includes('object/public/theatre-data')));
}));

test('an interrupted archive copy retries the same durable page without another Blob listing or overwriting completed copies', async () => fixture(async state => {
  const { migrateFeedbackArchive } = require('../server/feedback-archive');
  let listings = 0, unavailable = true;
  const blobs = ['one', 'two'].map(id => ({ pathname: `intelligent-feedback/production/work/${id}.json`,
    url: `https://fixture.public.blob.vercel-storage.com/intelligent-feedback/production/work/${id}.json` }));
  const dependencies = { listLegacy: async () => { listings++; return { blobs, hasMore: false }; },
    fetchLegacy: async url => {
      if (unavailable && url === blobs[1].url) return new Response('', { status: 503 });
      return new Response(JSON.stringify({ environment: 'production', sessionId: url === blobs[0].url ? 'one' : 'two', entries: [] }));
    } };
  await assert.rejects(migrateFeedbackArchive('production', dependencies), /recuperar/);
  assert.ok(state.objects.has(`theatre-data/${blobs[0].pathname}`));
  unavailable = false;
  const result = await migrateFeedbackArchive('production', dependencies);
  assert.equal(result.complete, true); assert.equal(result.existing, 1); assert.equal(result.copied, 1); assert.equal(listings, 1);
}));

test('archive maintenance is authenticated and rejects another environment or an untrusted download URL', async () => fixture(async state => {
  const denied = response();
  await require('../server/storage-setup')({ method: 'POST', headers: {}, query: { action: 'migrate-feedback' } }, denied);
  assert.equal(denied.statusCode, 401); assert.equal(state.calls.length, 0);
  const { migrateFeedbackArchive } = require('../server/feedback-archive');
  let downloads = 0;
  const pathname = 'intelligent-feedback/production/work/report.json';
  await assert.rejects(migrateFeedbackArchive('production', {
    listLegacy: async () => ({ blobs: [{ pathname, url: `https://untrusted.test/${pathname}` }] }),
    fetchLegacy: async () => { downloads++; },
  }), /ruta/);
  assert.equal(downloads, 0);
  state.objects.clear();
  await assert.rejects(migrateFeedbackArchive('production', {
    listLegacy: async () => ({ blobs: [{ pathname, url: `https://fixture.public.blob.vercel-storage.com/${pathname}` }] }),
    fetchLegacy: async () => new Response(JSON.stringify({ environment: 'preview', sessionId: 'report', entries: [] })),
  }), /entorno/);
  assert.equal(state.objects.has(`theatre-data/${pathname}`), false);
}));
