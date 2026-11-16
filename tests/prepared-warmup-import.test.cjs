const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const loader = require.extensions['.ts'];
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
let uploads = [], invalidated = false;
const originalLoad = Module._load;
Module._load = function (id, parent, ...args) {
  if (parent?.filename.endsWith('preparedWarmup.ts')) {
    if (id === './sharedSongUploads') return { uploadSharedSongAudio: async input => { uploads.push(input); return { url: `https://test.public.blob.vercel-storage.com/shared-scripts/preview/${input.shareId}/warmups/${input.targetId}/${input.file.name}` }; } };
    if (id === '../store/adminSession') return { invalidateAdminSession: () => { invalidated = true; } };
    if (id === './sharedApiUrl') return { buildSharedApiUrl: (path, params) => path + (params ? '?' + new URLSearchParams(params) : '') };
  }
  return originalLoad.call(this, id, parent, ...args);
};
const { importPreparedWarmup } = require('../src/api/preparedWarmup.ts');
Module._load = originalLoad;
if (loader) require.extensions['.ts'] = loader; else delete require.extensions['.ts'];
const bundle = () => {
  const catalog = structuredClone(require('../warmups/canto-2026-11/source.json'));
  catalog.exercises = catalog.exercises.filter(e => e.id === 'm-cinco-notas');
  const exercise = catalog.exercises[0];
  exercise.explanation = { audioUrl: 'explanation.mp3', durationSeconds: 10 };
  exercise.piano = { 50: { audioUrl: 'piano-50.mp3', durationSeconds: 4 }, 51: { audioUrl: 'piano-50.mp3', durationSeconds: 4 } };
  return { catalog, files: { 'explanation.mp3': btoa('voice'), 'piano-50.mp3': btoa('piano') } };
};

test('import uploads each prepared file once through song storage and confirms the shared read path', async () => {
  const oldFetch = global.fetch, messages = []; uploads = []; let saved, calls = [];
  global.fetch = async (url, options) => {
    calls.push(url);
    if (options?.method === 'POST') { saved = JSON.parse(options.body).catalog; return { ok: true, status: 200, json: async () => ({ catalog: saved }) }; }
    return { ok: true, json: async () => ({ catalog: saved }) };
  };
  try {
    const result = await importPreparedWarmup(new File([JSON.stringify(bundle())], 'prepared.warmup.json'), 'test-work', value => messages.push(value));
    assert.equal(uploads.length, 2); assert.ok(uploads.every(input => input.shareId === 'test-work' && input.targetType === 'warmup'));
    assert.equal(await uploads[0].file.text(), 'voice');
    assert.equal(result.exercises[0].piano['50'].audioUrl, result.exercises[0].piano['51'].audioUrl);
    assert.match(calls[1], /shareId=test-work/); assert.ok(messages.length >= 3);
  } finally { global.fetch = oldFetch; }
});

test('a missing file or remote reference is rejected before any upload, and an unauthorized catalogue save never reports success', async () => {
  const oldFetch = global.fetch; uploads = []; invalidated = false;
  const missing = bundle(); delete missing.files['piano-50.mp3'];
  await assert.rejects(importPreparedWarmup(new File([JSON.stringify(missing)], 'missing.json'), 'work', () => {}), /Falta un audio/); assert.equal(uploads.length, 0);
  const remote = bundle(); remote.catalog.exercises[0].explanation.audioUrl = 'https://example.com/remote.mp3';
  await assert.rejects(importPreparedWarmup(new File([JSON.stringify(remote)], 'remote.json'), 'work', () => {}), /Falta un audio/); assert.equal(uploads.length, 0);
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'Acceso caducado' }) });
  try {
    await assert.rejects(importPreparedWarmup(new File([JSON.stringify(bundle())], 'prepared.json'), 'work', () => {}), /Acceso caducado/);
    assert.equal(invalidated, true);
  } finally { global.fetch = oldFetch; }
});

test('a stale public catalogue with the same id is not reported as the newly imported version', async () => {
  const oldFetch = global.fetch; let saved;
  global.fetch = async (_url, options) => {
    if (options?.method === 'POST') { saved = JSON.parse(options.body).catalog; return { ok: true, status: 200, json: async () => ({ catalog: saved }) }; }
    return { ok: true, json: async () => ({ catalog: { ...saved, title: 'Earlier cached title' } }) };
  };
  try { await assert.rejects(importPreparedWarmup(new File([JSON.stringify(bundle())], 'prepared.json'), 'work', () => {}), /no se pudo comprobar/); }
  finally { global.fetch = oldFetch; }
});
