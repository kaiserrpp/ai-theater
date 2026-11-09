const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAuditionScenes, normalizeAuditionScript, validateAuditionScript, resolveAuditionPreferences,
} = require('../shared/auditionScenes');
const sharedPath = require.resolve('../api/shared-script/_shared');
const realShared = require(sharedPath);

const script = () => ({ obra: 'Prueba', personajes: ['PERSONAJE INCORRECTO'], guion: [
  { p: 'ANA', t: '¿Has traído la carta?', a: 'Se acerca a la puerta.' },
  { p: 'LUIS', t: 'La tengo aquí.' },
  { p: 'ANA / LUIS', r: ['ANA', 'LUIS'], t: 'Vamos a leerla.' },
] });
const scene = (id = 'audition-one') => ({ id, title: 'La carta', fileName: 'carta.pdf', revision: 1,
  scriptData: normalizeAuditionScript(script(), 'La carta'), createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' });
const baseManifest = () => realShared.normalizeManifest({ shareId: 'test-work', scriptData: { obra: 'Obra', personajes: [], guion: [] },
  musicalNumbers: [{ id: 'number-one', title: 'Canción preparada', startLineIndex: -1, endLineIndex: -1,
    audios: [{ id: 'audio-one', kind: 'karaoke', label: 'Pista', audioUrl: 'https://example.com/practice.mp3' }] }],
  auditionScenes: [scene()],
});

const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
before(() => { process.env.BLOB_READ_WRITE_TOKEN = 'test-only'; });
after(() => {
  if (originalToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = originalToken;
});

const setup = (file, manifest = baseManifest(), failRead = false) => {
  let current = structuredClone(manifest);
  let writes = 0;
  const originalModule = require.cache[sharedPath];
  require.cache[sharedPath] = { ...originalModule, exports: { ...realShared,
    hasSongAdminPasswordConfigured: () => true,
    isValidSongAdminPassword: (password) => password === 'test-admin',
    isAuthorizedSongAdminRequest: (_request, password) => password === 'test-admin',
    readManifest: async () => { if (failRead) throw new Error('Lectura fallida'); return structuredClone(current); },
    writeManifest: async (value) => { writes += 1; current = realShared.normalizeManifest(value); return structuredClone(current); },
  } };
  const handlerPath = require.resolve(`../api/shared-script/${file}`);
  delete require.cache[handlerPath];
  const handler = require(handlerPath);
  require.cache[sharedPath] = originalModule;
  return {
    manifest: () => current, writes: () => writes,
    request: async (method, body) => {
      const response = { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; },
        status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
      await handler({ method, body, headers: { host: 'localhost' } }, response);
      return response;
    },
  };
};
const input = () => ({ shareId: 'test-work', password: 'test-admin', title: 'La carta', fileName: 'carta.pdf', scriptData: script() });

test('legacy works load with no auditions; standalone music and auditions survive adding a main script', () => {
  assert.deepEqual(normalizeAuditionScenes(undefined), []);
  const manifest = baseManifest();
  const next = realShared.normalizeManifest({ ...manifest, scriptData: script() });
  assert.deepEqual(next.musicalNumbers, manifest.musicalNumbers);
  assert.deepEqual(next.auditionScenes, manifest.auditionScenes);
  assert.equal(next.musicalNumbers[0].audios[0].audioUrl, 'https://example.com/practice.mp3');
});

test('characters come from the actual dialogue, including shared lines; directions and order are kept', () => {
  const original = script();
  const normalized = normalizeAuditionScript(original, 'Mini-guion');
  assert.deepEqual(normalized.personajes, ['ANA', 'LUIS']);
  assert.equal(normalized.guion[0].p, 'ESCENA_SISTEMA');
  assert.equal(normalized.guion[1].a, original.guion[0].a);
  assert.deepEqual(normalized.guion.slice(1), original.guion);
  assert.equal(original.guion[0].p, 'ANA');
});

test('malformed, empty and non-speaking scripts are rejected before saving', () => {
  for (const invalid of [null, {}, { guion: [] }, { guion: [{ p: '', t: 'Texto' }] },
    { guion: [{ p: 'ANA', t: '' }] }, { guion: [{ p: 'ANA', t: 'Texto', r: [42] }] },
    { guion: [{ p: ' ESCENA_SISTEMA ', t: 'Escena' }] }, { guion: [{ p: 'CANCION_SISTEMA', t: 'Letra' }] }]) {
    assert.equal(typeof validateAuditionScript(invalid), 'string');
  }
  assert.equal(validateAuditionScript(script()), null);
});

test('progress survives the same revision but resets after text changes, retaining valid character choices', () => {
  const saved = { roles: ['ANA', 'OTRO', 'ANA'], lineIndex: 2, revision: 1 };
  assert.deepEqual(resolveAuditionPreferences(scene(), saved), { roles: ['ANA'], lineIndex: 2, revision: 1 });
  assert.deepEqual(resolveAuditionPreferences({ ...scene(), revision: 2 }, saved), { roles: ['ANA'], lineIndex: 0, revision: 2 });
  assert.equal(resolveAuditionPreferences(scene(), { ...saved, lineIndex: 999 }).lineIndex, scene().scriptData.guion.length);
  assert.equal(resolveAuditionPreferences(scene(), null).lineIndex, 0);
});

test('creating multiple auditions, including duplicate titles, preserves the work and music', async () => {
  const api = setup('audition-scene');
  const beforeManifest = api.manifest();
  for (let count = 0; count < 2; count += 1) assert.equal((await api.request('POST', input())).statusCode, 200);
  assert.equal(api.manifest().auditionScenes.length, 3);
  assert.equal(new Set(api.manifest().auditionScenes.map((value) => value.id)).size, 3);
  assert.deepEqual(api.manifest().scriptData, beforeManifest.scriptData);
  assert.deepEqual(api.manifest().musicalNumbers, beforeManifest.musicalNumbers);
});

test('editing retains identity and timestamps, increments the text revision, and leaves other scenes unchanged', async () => {
  const initial = baseManifest();
  initial.auditionScenes.push(scene('audition-two'));
  const api = setup('audition-scene', initial);
  const changed = input();
  changed.scriptData.guion[0].t = 'La carta ha desaparecido.';
  const result = await api.request('PATCH', { ...changed, sceneId: scene().id, revision: 1 });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.auditionScenes[0].revision, 2);
  assert.equal(result.body.auditionScenes[0].createdAt, initial.auditionScenes[0].createdAt);
  assert.deepEqual(result.body.auditionScenes[1], initial.auditionScenes[1]);
  assert.equal((await api.request('PATCH', { ...input(), sceneId: scene().id, revision: 1 })).statusCode, 409);
  assert.equal(api.writes(), 1);
});

test('changing only a title retains the rehearsal revision', async () => {
  const api = setup('audition-scene');
  const result = await api.request('PATCH', { ...input(), title: 'Otro título', scriptData: scene().scriptData, sceneId: scene().id, revision: 1 });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.auditionScenes[0].revision, 1);
});

test('scene writes require the management password; invalid requests never write', async () => {
  const api = setup('audition-scene');
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    assert.equal((await api.request(method, { ...input(), password: 'incorrect' })).statusCode, 401);
  }
  assert.equal((await api.request('POST', { ...input(), scriptData: { guion: [] } })).statusCode, 400);
  assert.equal((await api.request('POST', '{invalid')).statusCode, 400);
  assert.equal((await api.request('POST', 'null')).statusCode, 400);
  assert.equal((await api.request('POST', '[]')).statusCode, 400);
  assert.equal((await api.request('GET', {})).statusCode, 405);
  assert.equal(api.writes(), 0);
});

test('deleting checks the revision and removes only the selected audition', async () => {
  const initial = baseManifest();
  initial.auditionScenes.push(scene('audition-two'));
  const api = setup('audition-scene', initial);
  assert.equal((await api.request('DELETE', { ...input(), sceneId: scene().id, revision: 0 })).statusCode, 409);
  const result = await api.request('DELETE', { ...input(), sceneId: scene().id, revision: 1 });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.auditionScenes, [initial.auditionScenes[1]]);
  assert.deepEqual(result.body.musicalNumbers, initial.musicalNumbers);
});

test('republishing, including an older client payload, preserves server audition scenes', async () => {
  const api = setup('publish');
  const previous = api.manifest();
  const result = await api.request('POST', { shareId: previous.shareId, password: 'test-admin',
    scriptData: script(), songs: previous.songs, musicalNumbers: previous.musicalNumbers, auditionScenes: [] });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.manifest.auditionScenes, previous.auditionScenes);
  assert.deepEqual(result.body.manifest.musicalNumbers, previous.musicalNumbers);
});

test('publishing requires management access and a failed previous read cannot overwrite existing scenes', async () => {
  const unauthorized = setup('publish');
  assert.equal((await unauthorized.request('POST', { scriptData: script() })).statusCode, 401);
  assert.equal(unauthorized.writes(), 0);
  const unavailable = setup('publish', baseManifest(), true);
  const result = await unavailable.request('POST', { ...input(), songs: [] });
  assert.equal(result.statusCode, 500);
  assert.equal(unavailable.writes(), 0);
});
