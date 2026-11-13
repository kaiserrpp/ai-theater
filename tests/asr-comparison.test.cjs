const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const coreModule = import(pathToFileURL(path.resolve(__dirname, '../public/asr/comparison-core.mjs')));
const captureModule = import(pathToFileURL(path.resolve(__dirname, '../public/asr/comparison-capture.mjs')));
const { normalizeRecognitionComparison } = require('../shared/recognitionComparison');
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };

test('both engines receive the same sample including pauses, independently and sequentially', async () => {
  const { compareSample } = await coreModule;
  const original = new Float32Array([0.2, 0, 0, 0, 0.4]); const events = [];
  const results = await compareSample({ audio: original, expected: 'Really?', signal: new AbortController().signal,
    engines: { vosk: async (audio) => { events.push('vosk'); assert.deepEqual(audio, original); audio.fill(0); return { text: 'riley', loadMs: 20, processingMs: 30 }; },
      whisper: async (audio) => { events.push('whisper'); assert.deepEqual(audio, original); return { text: 'Really', loadMs: 50, processingMs: 60 }; } } });
  assert.deepEqual(events, ['vosk', 'whisper']);
  assert.equal(original[0], Math.fround(0.2));
  assert.equal(results.length, 2); assert.ok(results.every((value) => value.accepted));
  assert.equal(results[0].literalDifference, 1); assert.equal(results[1].literalDifference, 0);
});

test('comparison uses the existing flexible Intelligent rules, without requiring a literal ending', async () => {
  const { evaluateTranscript } = await coreModule;
  const expected = 'Abuela, que pasó? Porque gritas? Pasó algo malo?';
  assert.equal(evaluateTranscript(expected, 'abuela qué pasó').accepted, false);
  assert.equal(evaluateTranscript(expected, 'abuela qué pasó porque gritas pasó algo malo').accepted, true);
  assert.equal(evaluateTranscript(expected, 'abuela qué pasó porque gritas pasó algo').accepted, true);
  assert.equal(evaluateTranscript('Sure (se ríe)', 'sur').accepted, true);
  assert.equal(evaluateTranscript('Really?', '').accepted, false);
});

test('an engine failure still permits testing the other engine and is retained in the report without audio', async () => {
  const { compareSample, makeFeedbackEntries } = await coreModule;
  const results = await compareSample({ audio: new Float32Array(16000), expected: 'Sure', signal: new AbortController().signal,
    engines: { vosk: async () => { throw new Error('model load failed'); }, whisper: async () => ({ text: 'Sure', processingMs: 123, loadMs: 456 }) } });
  const entries = makeFeedbackEntries({ id: 'one', phraseIndex: 1, expected: 'Sure', results, durationMs: 1000,
    language: 'auto', createdAt: '2026-11-11', order: ['vosk', 'whisper'], audio: new Float32Array([0.77]) });
  assert.equal(entries[0].recognitionComparison.error, 'model load failed');
  assert.equal(entries[1].recognitionComparison.processingMs, 123);
  assert.equal(entries[1].recognitionComparison.timingKind, 'offline_processing');
  assert.ok(entries.every((entry) => entry.result === 'comparacion_local' && entry.recognitionComparison.audioUploaded === false));
  assert.ok(!JSON.stringify(entries).includes('0.77')); assert.ok(!Object.hasOwn(entries[0], 'audio'));
});

test('cancellation ignores a late result and never starts the next model', async () => {
  const { compareSample } = await coreModule;
  const pending = deferred(), controller = new AbortController(); let second = 0, delivered = 0;
  const run = compareSample({ audio: new Float32Array(1000), expected: 'Hola', signal: controller.signal,
    engines: { vosk: () => pending.promise, whisper: async () => { second++; return { text: 'Hola' }; } }, onResult: () => delivered++ });
  controller.abort(); pending.resolve({ text: 'Hola' });
  await assert.rejects(run, { name: 'AbortError' }); assert.equal(second, 0); assert.equal(delivered, 0);
});

test('resampling preserves duration, signal and silence at the 16 kHz shared input', async () => {
  const { resampleAudio } = await coreModule;
  const constant = new Float32Array(48000).fill(0.25), converted = resampleAudio(constant, 48000);
  assert.equal(converted.length, 16000); assert.ok(converted.every((value) => value === 0.25));
  assert.ok(resampleAudio(new Float32Array(44100), 44100).every((value) => value === 0));
  const copy = resampleAudio(constant, 16000); assert.notEqual(copy, constant); assert.deepEqual(copy, constant);
  assert.throws(() => resampleAudio(constant, 0));
});

const captureFixture = async (overrides = {}) => {
  const { createSampleCapture } = await captureModule;
  const contexts = [], streams = []; let permissionInTap = false, inTap = false, limits = 0;
  const makeStream = () => { const track = { stopped: false, stop() { this.stopped = true; } }; const stream = { getTracks: () => [track] }; streams.push(stream); return stream; };
  const node = () => ({ connect() {}, disconnect() {} });
  const capture = createSampleCapture({ getUserMedia: () => { permissionInTap = inTap; return Promise.resolve(makeStream()); },
    createContext: () => { const context = { sampleRate: 16000, destination: {}, resume: async () => {}, close: async () => {},
      createMediaStreamSource: node, createGain: () => ({ ...node(), gain: {} }), createScriptProcessor: () => (context.processor = node()) }; contexts.push(context); return context; },
    onLimit: () => { limits++; }, ...overrides });
  return { capture, contexts, streams, makeStream, limits: () => limits, permissionInTap: () => permissionInTap,
    start: () => { inTap = true; const pending = capture.start(); inTap = false; return pending; },
    feed: (values) => contexts.at(-1).processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => values } }) };
};

test('recording retains multi-second pauses until explicit stop and requests permission in the tap', async () => {
  const f = await captureFixture(); await f.start();
  assert.equal(f.permissionInTap(), true);
  f.feed(new Float32Array(16000).fill(0.2)); f.feed(new Float32Array(80000)); f.feed(new Float32Array(16000).fill(0.3));
  assert.equal(f.streams[0].getTracks()[0].stopped, false);
  f.capture.stop(); const sample = f.capture.getSample();
  assert.equal(sample.length, 112000); assert.equal(sample[50000], 0);
  assert.equal(f.streams[0].getTracks()[0].stopped, true); assert.equal(f.limits(), 0);
});

test('stopping while microphone permission is pending closes a late grant without opening audio processing', async () => {
  const pending = deferred(); const f = await captureFixture({ getUserMedia: () => pending.promise });
  const started = f.start(); f.capture.stop(); pending.resolve(f.makeStream());
  assert.equal(await started, false); assert.equal(f.streams[0].getTracks()[0].stopped, true);
  assert.equal(f.contexts[0].processor, undefined);
});

test('the sample size limit closes the microphone and preserves audio without triggering comparison or changing a line', async () => {
  const f = await captureFixture(); await f.start();
  f.feed(new Float32Array(16000 * 46));
  assert.equal(f.capture.getSample().length, 16000 * 45); assert.equal(f.limits(), 1);
  assert.equal(f.streams[0].getTracks()[0].stopped, true);
});

test('comparison metadata only retains text metrics and bounded timing values', () => {
  const result = normalizeRecognitionComparison({ engine: 'whisper', status: 'done', sampleId: 'test', processingMs: 44,
    loadMs: Infinity, sampleDurationMs: -1, literalDifference: 0.2, accepted: true, verdict: 'correct',
    order: 'vosk,whisper', audio: 'PRIVATE AUDIO', audioUploaded: true, secret: 'PRIVATE KEY' });
  assert.equal(result.loadMs, null); assert.equal(result.sampleDurationMs, null);
  assert.equal(result.processingMs, 44); assert.equal(result.audioUploaded, false);
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(normalizeRecognitionComparison({ engine: 'other', status: 'done' }), null);
  const context = normalizeRecognitionComparison({ engine: 'whisper', status: 'done', contextUsed: true,
    contextPrompt: 'Sonny. English', contextTermCount: 2 });
  assert.equal(context.contextPrompt, 'Sonny. English'); assert.equal(context.contextUsed, true); assert.equal(context.contextTermCount, 2);
  assert.equal(normalizeRecognitionComparison({ engine: 'whisper', status: 'done', contextUsed: false, contextPrompt: 'Ignore this', contextTermCount: Infinity }).contextPrompt, null);
});

test('the feedback endpoint keeps both engines and their paired sample IDs', async (t) => {
  const blobPath = require.resolve('@vercel/blob'); require(blobPath);
  const original = require.cache[blobPath].exports; let stored;
  require.cache[blobPath].exports = { ...original, put: async (_pathname, body) => { stored = JSON.parse(body); return { url: 'https://test.public.blob.vercel-storage.com/report.json' }; } };
  const handlerPath = require.resolve('../api/shared-script/intelligent-feedback'); delete require.cache[handlerPath];
  const handler = require(handlerPath); require.cache[blobPath].exports = original;
  const token = process.env.BLOB_READ_WRITE_TOKEN; process.env.BLOB_READ_WRITE_TOKEN = 'test-only';
  t.after(() => { if (token === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = token; });
  const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, setHeader() {} };
  const { makeFeedbackEntries } = await coreModule;
  const entries = makeFeedbackEntries({ id: 'paired', caseId: 'all-three', expected: 'Really', phraseIndex: 0, durationMs: 1200, language: 'auto', order: ['vosk', 'whisper'],
    results: [{ engine: 'vosk', status: 'done', text: 'riley' }, { engine: 'whisper', status: 'done', text: 'Really',
      backend: 'webgpu', encoderDevice: 'webgpu', encoderDtype: 'fp32', timingKind: 'paced_replay',
      replay: { firstTextMs: 500, acceptedAtMs: 600, speechEndMs: 800, decisionAfterSpeechMs: -200,
        speechEndKind: 'sample_rms_estimate', events: [{ atMs: 500, audioMs: 700, text: 'Really', interim: true }] } }] });
  entries.push(...makeFeedbackEntries({ id: 'different-take', caseId: 'all-three', expected: 'Really', durationMs: 2000,
    language: 'spanish', order: ['native'], results: [{ engine: 'native', status: 'done', text: 'Really',
      backend: 'browser', timingKind: 'native_live', native: { firstTextMs: 400, acceptedAtMs: 450, speechEndMs: 500,
        speechEndKind: 'browser_speechend_event', events: [{ atMs: 400, text: 'Really', interim: false }] } }] }));
  Object.assign(entries[1], { recognitionEngine: 'whisper', scriptContextEnabled: true, scriptContextTermCount: 42 });
  await handler({ method: 'POST', headers: {}, body: { sessionId: 'comparison-test', scriptId: 'local-test', entries } }, response);
  assert.equal(response.statusCode, 200); assert.equal(stored.entryCount, 3);
  assert.deepEqual(stored.entries.map((entry) => entry.recognitionComparison.engine), ['vosk', 'whisper', 'native']);
  assert.ok(stored.entries.slice(0, 2).every((entry) => entry.recognitionComparison.sampleId === 'paired'));
  assert.ok(stored.entries.every((entry) => entry.recognitionComparison.comparisonId === 'all-three'));
  const measured = stored.entries[1].recognitionComparison;
  assert.equal(measured.backend, 'webgpu'); assert.equal(measured.timingKind, 'paced_replay');
  assert.equal(measured.replay.decisionAfterSpeechMs, -200); assert.equal(measured.replay.events[0].text, 'Really');
  assert.equal(stored.entries[2].recognitionComparison.sameAudioPair, false);
  assert.equal(stored.entries[2].recognitionComparison.sampleId, 'different-take');
  assert.equal(stored.entries[2].recognitionComparison.native.firstTextMs, 400);
  assert.equal(stored.entries[1].recognitionEngine, 'whisper'); assert.equal(stored.entries[1].scriptContextEnabled, true); assert.equal(stored.entries[1].scriptContextTermCount, 42);
});

test('the newest comparison report is ordered by its date, including Thursday to Friday', async t => {
  const blobPath = require.resolve('@vercel/blob'), original = require(blobPath);
  const oldFetch = global.fetch;
  const oldEnv = Object.fromEntries(['BLOB_READ_WRITE_TOKEN', 'SONG_ADMIN_PASSWORD', 'SHARED_STORAGE_NAMESPACE'].map(key => [key, process.env[key]]));
  Object.assign(process.env, { BLOB_READ_WRITE_TOKEN: 'test-only', SONG_ADMIN_PASSWORD: 'test-only', SHARED_STORAGE_NAMESPACE: 'test' });
  t.after(() => { global.fetch = oldFetch; require.cache[blobPath].exports = original;
    for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  require.cache[blobPath].exports = { ...original,
    list: async () => ({ blobs: [
      { pathname: 'thursday.json', uploadedAt: 'Thu Nov 12 2026 23:00:00 GMT+0000' },
      { pathname: 'friday.json', uploadedAt: 'Fri Nov 13 2026 00:19:00 GMT+0000' },
    ] }), head: async pathname => ({ url: `https://report.test/${pathname}` }) };
  global.fetch = async url => ({ ok: true, json: async () => ({ source: url }) });
  const handlerPath = require.resolve('../api/shared-script/intelligent-feedback'); delete require.cache[handlerPath];
  const handler = require(handlerPath);
  const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; }, setHeader() {} };
  await handler({ method: 'GET', headers: { 'x-song-admin-password': 'test-only' }, query: {} }, response);
  assert.equal(response.statusCode, 200); assert.equal(response.body.reports[0].pathname, 'friday.json');
  assert(response.body.latestReport.source.includes('friday.json'));
});
