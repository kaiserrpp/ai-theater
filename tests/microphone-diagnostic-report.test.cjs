const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('a preparation diagnostic can be sent without scene results, with bounded errors and no audio', async t => {
  const saved = [];
  const previousLoad = Module._load, previousToken = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = 'unit-test-only';
  t.after(() => { if (previousToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = previousToken; });
  Module._load = function (name, ...args) {
    if (name === '@vercel/blob') return { put: async (pathname, text) => { saved.push({ pathname, body: JSON.parse(text) }); return { url: 'https://example.test/diagnostic' }; } };
    if (name === './_shared') return { getStorageNamespace: () => 'preview', parseJsonBody: request => request.body };
    return previousLoad.call(this, name, ...args);
  };
  let handler;
  try { handler = require('../api/shared-script/intelligent-feedback.js'); } finally { Module._load = previousLoad; }
  const diagnostic = { kind: 'microphone_input', status: 'error', stage: 'capture', errorName: 'NotReadableError',
    errorMessage: 'Could not start audio source', audio: [0.42], attempts: [
      { profile: 'processed', status: 'error', elapsedMs: 21.4, errorName: 'NotReadableError', errorMessage: 'first', audio: [0.42] },
      { profile: 'unprocessed', status: 'error', elapsedMs: Infinity, errorName: 'NotReadableError', errorMessage: 'x'.repeat(1000) },
      { profile: 'processed', status: 'error', elapsedMs: 50 },
    ] };
  const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; } });
  const result = response();
  await handler({ method: 'POST', body: { sessionId: 'diagnostic-retry', scriptId: 'work', appVersion: '2026.11.229',
    runtime: 'native_android', nativeAppVersion: '2026.11.228', entries: [], microphoneDiagnostic: diagnostic } }, result);
  assert.equal(result.code, 200); assert.equal(result.body.entryCount, 0);
  const report = saved[0].body;
  assert.equal(report.environment, 'preview'); assert.equal(report.nativeAppVersion, '2026.11.228');
  assert.equal(report.appVersion, '2026.11.229'); assert.deepEqual(report.entries, []);
  assert.equal(report.microphoneDiagnostic.attempts.length, 2);
  assert.equal(report.microphoneDiagnostic.attempts[0].elapsedMs, 21);
  assert.equal(report.microphoneDiagnostic.attempts[1].elapsedMs, null);
  assert.equal(report.microphoneDiagnostic.attempts[1].errorMessage.length, 300);
  assert(!JSON.stringify(report).includes('0.42'));
  const native = response();
  await handler({ method: 'POST', body: { sessionId: 'native-meter', scriptId: 'work', entries: [], microphoneDiagnostic: {
    ...diagnostic, attempts: [{ profile: 'native_peak', status: 'error', errorName: 'NativeCaptureError', errorMessage: 'native device failed', elapsedMs: 100 }],
  } } }, native);
  assert.equal(native.code, 200); assert.equal(saved[1].body.microphoneDiagnostic.attempts[0].profile, 'native_peak');
  const invalid = response();
  await handler({ method: 'POST', body: { entries: [], microphoneDiagnostic: { ...diagnostic, kind: 'anything' } } }, invalid);
  assert.equal(invalid.code, 400); assert.equal(saved.length, 2);
  for (const mode of ['manual', 'auto', 'intelligent']) {
    const completed = response();
    await handler({ method: 'POST', body: { sessionId: `completed-${mode}`, entries: [],
      completedRehearsal: { lineCount: 21, listenMode: mode, elapsedMs: 1234.4, audio: [0.42] } } }, completed);
    assert.equal(completed.code, 200);
    assert.deepEqual(saved.at(-1).body.completedRehearsal, { lineCount: 21, listenMode: mode, elapsedMs: 1234 });
    assert.deepEqual(saved.at(-1).body.entries, []);
    assert.equal(JSON.stringify(saved.at(-1).body).includes('0.42'), false);
  }
  for (const summary of [{ lineCount: 0, listenMode: 'manual', elapsedMs: 0 },
    { lineCount: 1, listenMode: 'fake', elapsedMs: 0 }, { lineCount: 1, listenMode: 'manual', elapsedMs: -1 }]) {
    const result = response();
    await handler({ method: 'POST', body: { entries: [], completedRehearsal: summary } }, result);
    assert.equal(result.code, 400);
  }
});
