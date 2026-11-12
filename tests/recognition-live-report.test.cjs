const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('feedback preserves bounded live processing timings separately from offline samples, with no recorded audio', async t => {
  let saved;
  const previousLoad = Module._load;
  const previousToken = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = 'unit-test-only';
  t.after(() => { if (previousToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = previousToken; });
  Module._load = function (name, ...args) {
    if (name === '@vercel/blob') return { put: async (_path, body) => { saved = JSON.parse(body); return { url: 'https://example.test/report.json' }; } };
    if (name === './_shared') return { getStorageNamespace: () => 'development', parseJsonBody: request => request.body };
    return previousLoad.call(this, name, ...args);
  };
  let handler;
  try { handler = require('../api/shared-script/intelligent-feedback.js'); }
  finally { Module._load = previousLoad; }
  const timing = { kind: 'live_processing', processingMs: 2200.4, requestToTextMs: 2310.6, queueMs: 100, audioDurationMs: 1800, audio: [0.7] };
  const entry = { expectedText: 'Ey, Sonny.', heardText: 'Hey, Sonny.', recognitionEngine: 'whisper', recognitionTiming: timing };
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await handler({ method: 'POST', body: { sessionId: 'speed-test', scriptId: 'script', entries: [
    entry, { ...entry, recognitionEngine: 'vosk' },
    { ...entry, recognitionTiming: { ...timing, processingMs: Infinity, queueMs: -5, audioDurationMs: 1000000 } },
  ] } }, response);
  assert.equal(response.code, 200);
  assert.equal(saved.environment, 'development');
  assert.deepEqual(saved.entries[0].recognitionTiming, { kind: 'live_processing', requestToTextMs: 2311, processingMs: 2200, queueMs: 100, audioDurationMs: 1800 });
  assert.equal(saved.entries[1].recognitionTiming, null);
  assert.equal(saved.entries[2].recognitionTiming.processingMs, null);
  assert.equal(saved.entries[2].recognitionTiming.queueMs, 0);
  assert.equal(saved.entries[2].recognitionTiming.audioDurationMs, 180000);
  assert.equal(saved.entries[0].recognitionComparison, undefined);
});
