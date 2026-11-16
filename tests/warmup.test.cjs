const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const oldLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { planWarmupExercise, voicePreferences, restoreWarmupPreferences, WARMUP_VOICES } = require('../src/utils/warmup.ts');
const { createSongPlayback } = require('../src/utils/songPlayback.ts');
if (oldLoader) require.extensions['.ts'] = oldLoader; else delete require.extensions['.ts'];
const { validateWarmupCatalog } = require('../shared/warmupCatalog');
const fixture = () => {
  const source = structuredClone(require('../warmups/canto-2026-11/source.json'));
  source.exercises[0].explanation = { audioUrl: 'https://example.com/explanation.mp3', durationSeconds: 20 };
  source.exercises[0].piano = Object.fromEntries(Array.from({ length: 42 }, (_, i) => [36 + i, { audioUrl: `https://example.com/piano-${36 + i}.mp3`, durationSeconds: 3.934 }]));
  return source;
};

test('all six starting voices produce only complete patterns within the chosen personal limits', () => {
  const exercise = fixture().exercises[0];
  for (const voice of WARMUP_VOICES) {
    const prefs = voicePreferences(voice.id), plan = planWarmupExercise(exercise, prefs);
    assert.equal(plan.roots[0], voice.start);
    assert.ok(plan.low >= prefs.low && plan.high <= prefs.high);
    for (const root of plan.roots) for (const offset of exercise.score.offsets) assert.ok(root + offset >= prefs.low && root + offset <= prefs.high);
    assert.equal(new Set(plan.tracks.map(track => track.key)).size, plan.tracks.length);
    assert.equal(plan.tracks[0].phase, 'explanation');
    assert.equal(plan.roots[0], plan.roots[1]); // source's initial repetition survives
  }
});

test('a narrower exercise limit shortens the climb and turns once, preserving every note of each pattern', () => {
  const exercise = fixture().exercises[0], prefs = voicePreferences('baritone');
  prefs.exercises[exercise.id] = { start: 50, low: 48, high: 62 };
  const plan = planWarmupExercise(exercise, prefs, false);
  assert.deepEqual(plan.roots, [50, 50, 51, 52, 53, 54, 55, 54, 53, 52]);
  assert.equal(plan.high, 62); assert.equal(plan.low, 50);
  assert.ok(plan.tracks.every(track => track.phase === 'piano'));
  prefs.exercises[exercise.id].high = 57;
  assert.deepEqual(planWarmupExercise(exercise, prefs).roots, [50, 50]);
});

test('different patterns and per-exercise starting notes are adapted independently, without one global transposition', () => {
  const first = fixture().exercises[0], second = structuredClone(first), prefs = voicePreferences('baritone');
  second.id = 'octave'; second.score.offsets = [0, 4, 7, 12, 7, 4, 0]; second.score.noteBeats = Array(7).fill(.5);
  second.score.startOffset = -3;
  prefs.exercises[first.id] = { start: 51, high: 63 };
  prefs.exercises[second.id] = { start: 48, high: 62 };
  const a = planWarmupExercise(first, prefs), b = planWarmupExercise(second, prefs);
  assert.equal(a.roots[0], 51); assert.equal(b.roots[0], 48);
  assert.equal(a.high, 63); assert.equal(b.high, 62);
  assert.notDeepEqual(a.roots.map(root => root - a.roots[0]), b.roots.map(root => root - b.roots[0]));
});

test('an impossible range, out-of-range start or missing prepared take is an error rather than a clipped pattern or generated music', () => {
  const exercise = fixture().exercises[0], prefs = voicePreferences('baritone');
  prefs.high = 55;
  assert.throws(() => planWarmupExercise(exercise, prefs), /inicial/);
  prefs.low = 50; prefs.high = 55;
  assert.throws(() => planWarmupExercise(exercise, prefs), /7 semitonos/);
  prefs.low = 43; prefs.high = 65; delete exercise.piano['50'];
  assert.throws(() => planWarmupExercise(exercise, prefs), /preparado/);
  prefs.low = NaN;
  assert.throws(() => planWarmupExercise(exercise, prefs), /Revisa/);
});

test('warmup preferences round trip while damaged values cannot change other app settings or create invalid notes', () => {
  const prefs = voicePreferences('mezzo'); prefs.low = 54; prefs.exercises['m-cinco-notas'] = { start: 59, high: 72 };
  assert.deepEqual(restoreWarmupPreferences(JSON.parse(JSON.stringify(prefs))), prefs);
  const damaged = restoreWarmupPreferences({ voice: 'unknown', low: -2, high: 300, exercises: { valid: { start: NaN, high: 72 }, '../bad': { start: 50 } }, recognitionEngine: 'other' });
  assert.equal(damaged.voice, 'baritone'); assert.equal(damaged.low, 43); assert.deepEqual(damaged.exercises, { valid: { high: 72 } });
  assert.equal(damaged.recognitionEngine, undefined);
});

test('catalogue requires prepared audio, timestamp evidence and an honest incomplete status', () => {
  const catalog = fixture(); assert.equal(validateWarmupCatalog(catalog), null);
  catalog.status = 'complete'; assert.match(validateWarmupCatalog(catalog), /pendientes/);
  catalog.status = 'pilot'; catalog.exercises[0].explanation.audioUrl = 'javascript:alert(1)';
  assert.match(validateWarmupCatalog(catalog), /audios/);
  catalog.exercises[0].explanation.audioUrl = 'https://example.com/audio.mp3';
  catalog.exercises[0].advice[0].sourceAt = 9999;
  assert.match(validateWarmupCatalog(catalog), /referencia/);
});

test('prepared warmup uses one existing player: explanation, repeated first piano entry, pause, resume and finite ending', () => {
  const exercise = fixture().exercises[0], plan = planWarmupExercise(exercise, voicePreferences('baritone'));
  let selected, playing, created = 0;
  const audio = { src: '', currentTime: 0, duration: 4, ended: false, pause() { this.onpause?.(); }, load() { this.currentTime = 0; this.ended = false; }, play() { this.onplay?.(); return Promise.resolve(); } };
  const player = createSongPlayback({ createAudio: () => { created++; return audio; }, onTrack: key => { selected = key; }, onPlaying: value => { playing = value; }, onPosition() {}, onDuration() {}, onQueue() {}, onError() {} });
  player.setRepeat('off'); player.play(plan.tracks[0], plan.tracks, 'queue');
  audio.onended(); assert.equal(selected, plan.tracks[1].key);
  audio.currentTime = 1.4; player.pause(); assert.equal(playing, false); player.resume(); assert.equal(audio.currentTime, 1.4);
  audio.onended(); assert.equal(selected, plan.tracks[2].key); assert.equal(audio.src, plan.tracks[1].audio.audioUrl); assert.equal(audio.currentTime, 0);
  for (let index = 3; index < plan.tracks.length; index++) audio.onended();
  audio.onended(); assert.equal(playing, false); assert.equal(created, 1);
  player.setRepeat('queue'); player.resume(); audio.onended(); assert.equal(selected, plan.tracks[0].key);
  const late = audio.onended; player.destroy(); late(); assert.equal(selected, plan.tracks[0].key);
});

test('warmup API reads only the chosen environment and share, never writes the script manifest, and permits only valid catalogues', async () => {
  const modulePath = require.resolve('../server/warmup-catalog');
  const originalLoad = Module._load, originalFetch = global.fetch;
  let namespace = 'preview', path, notFound = false, catalog = fixture();
  Module._load = function (id, parent, ...rest) {
    if (parent?.filename === modulePath && id === '@vercel/blob') return { head: async name => { path = name; if (notFound) throw Object.assign(new Error('missing'), { name: 'BlobNotFoundError' }); return { url: 'https://example.com/catalog.json' }; } };
    if (parent?.filename === modulePath && id === '../api/shared-script/_shared') return { getStorageNamespace: () => namespace, isAuthorizedSongAdminRequest: () => false, getSongAdminPasswordFromRequest: () => '' };
    return originalLoad.call(this, id, parent, ...rest);
  };
  delete require.cache[modulePath];
  const handler = require(modulePath);
  const run = async (method = 'GET', shareId = 'test-share') => {
    const result = { statusCode: 0, payload: null, setHeader() {}, status(n) { this.statusCode = n; return this; }, json(p) { this.payload = p; } };
    await handler({ method, query: { shareId } }, result); return result;
  };
  global.fetch = async url => { assert.ok(new URL(url).searchParams.has('_ts')); return { ok: true, json: async () => catalog }; };
  try {
    assert.equal((await run()).statusCode, 200); assert.equal(path, 'shared-scripts/preview/test-share/warmups/catalog.json');
    namespace = 'production'; await run(); assert.equal(path, 'shared-scripts/production/test-share/warmups/catalog.json');
    namespace = 'development'; await run(); assert.equal(path, 'shared-scripts/development/test-share/warmups/catalog.json');
    assert.equal((await run('POST')).statusCode, 401); assert.equal((await run('DELETE')).statusCode, 405); assert.equal((await run('GET', '../other')).statusCode, 400);
    notFound = true; assert.deepEqual((await run()).payload, { catalog: null });
    notFound = false; catalog = { version: 1 }; assert.equal((await run()).statusCode, 503);
  } finally { Module._load = originalLoad; global.fetch = originalFetch; delete require.cache[modulePath]; }
});

test('only an authorized admin can register a prepared catalogue and every audio stays within the selected environment and work', async () => {
  const modulePath = require.resolve('../server/warmup-catalog');
  const originalLoad = Module._load;
  let authorized = false, writes = [];
  Module._load = function (id, parent, ...rest) {
    if (parent?.filename === modulePath && id === '@vercel/blob') return { put: async (path, body) => writes.push({ path, body }) };
    if (parent?.filename === modulePath && id === '../api/shared-script/_shared') return { getStorageNamespace: () => 'preview', isAuthorizedSongAdminRequest: () => authorized, getSongAdminPasswordFromRequest: () => '', parseJsonBody: request => request.body };
    return originalLoad.call(this, id, parent, ...rest);
  };
  delete require.cache[modulePath];
  const handler = require(modulePath), catalog = fixture();
  const remap = namespace => {
    for (const take of [catalog.exercises[0].explanation, ...Object.values(catalog.exercises[0].piano)]) take.audioUrl = `https://test.public.blob.vercel-storage.com/shared-scripts/${namespace}/test-share/warmups/canto/test.mp3`;
  };
  const run = async body => {
    const result = { code: 0, payload: null, status(n) { this.code = n; return this; }, json(p) { this.payload = p; } };
    await handler({ method: 'POST', body }, result); return result;
  };
  try {
    remap('preview');
    assert.equal((await run({ shareId: 'test-share', catalog })).code, 401); assert.equal(writes.length, 0);
    authorized = true; remap('production');
    assert.equal((await run({ shareId: 'test-share', catalog })).code, 400); assert.equal(writes.length, 0);
    remap('preview'); assert.equal((await run({ shareId: 'test-share', catalog })).code, 200);
    assert.equal(writes.length, 1); assert.equal(writes[0].path, 'shared-scripts/preview/test-share/warmups/catalog.json');
    assert.equal(JSON.parse(writes[0].body).id, catalog.id);
    assert.equal((await run({ shareId: 'another-work', catalog })).code, 400); assert.equal(writes.length, 1);
  } finally { Module._load = originalLoad; delete require.cache[modulePath]; }
});
