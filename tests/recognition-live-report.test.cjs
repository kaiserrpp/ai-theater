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
  const timing = { kind: 'live_processing', processingMs: 2200.4, requestToTextMs: 2310.6, queueMs: 100, audioDurationMs: 1800, audio: [0.7], encoderDevice: 'webgpu', decoderDevice: 'wasm', encoderDtype: 'fp32',
    segmentFinalization: 'speech_gap', trailingQuietMs: 640, segmentationThreshold: 0.003 };
  const responseTiming = { kind: 'browser_events', origin: 'native_bridge', matchToVoiceRequestMs: 23, matchToVoiceStartEventMs: 47, inputCloseMs: 1, voiceRequestToStartEventMs: 24 };
  const entry = { expectedText: 'Ey, Sonny.', heardText: 'Hey, Sonny.', recognitionEngine: 'whisper', recognitionTiming: timing, responseTiming };
  const diagnostic = { kind: 'recognition_session', status: 'listening', elapsedMs: 3000, startCount: 2, audioStartCount: 2,
    textEventCount: 3, endCount: 1, retryCount: 1, noSpeechCount: 1, firstServiceStartMs: 20, firstAudioStartMs: 30,
    firstTextMs: 2000, inputActive: true, currentTranscriptEmpty: false, inputAlreadyActive: false,
    errors: [{ code: 'network', atMs: 100 }], audio: 'PRIVATE_AUDIO', transcript: 'PRIVATE_EXTRA_TEXT' };
  const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await handler({ method: 'POST', body: { runtime: 'native_ios', nativeAppVersion: '2026.11.224', sessionId: 'speed-test', scriptId: 'script', entries: [
    entry, { ...entry, recognitionEngine: 'vosk' },
    { ...entry, recognitionTiming: { ...timing, processingMs: Infinity, queueMs: -5, audioDurationMs: 1000000 } },
    { expectedText: 'No, pero', heardText: 'otra frase no pero no pero', recognitionEngine: 'native',
      recognitionDiagnostics: diagnostic, recognitionAttempt: { source: 'repeated_line', text: 'no pero', audio: 'PRIVATE_AUDIO' } },
    { expectedText: 'No, pero', heardText: '', recognitionEngine: 'native', recognitionDiagnostics: { ...diagnostic,
      status: 'error', firstTextMs: null, currentTranscriptEmpty: true }, recognitionAttempt: { source: 'latest_utterance', text: 'invented' } },
    { expectedText: 'No, pero', heardText: 'texto '.repeat(300) + 'no pero no pero', recognitionEngine: 'native',
      recognitionAttempt: { source: 'repeated_line', text: 'no pero' } },
  ] } }, response);
  assert.equal(response.code, 200);
  assert.equal(saved.environment, 'development');
  assert.equal(saved.runtime,'native_ios');assert.equal(saved.nativeAppVersion,'2026.11.224');
  assert.deepEqual(saved.entries[0].recognitionTiming, { kind: 'live_processing', requestToTextMs: 2311, processingMs: 2200, queueMs: 100, audioDurationMs: 1800,
    encoderDevice: 'webgpu', decoderDevice: 'wasm', encoderDtype: 'fp32', fallbackReason: null,
    segmentFinalization: 'speech_gap', trailingQuietMs: 640, segmentationThreshold: 0.003 });
  assert.deepEqual(saved.entries[0].responseTiming, responseTiming);
  assert.equal(saved.entries[1].recognitionTiming, null);
  assert.equal(saved.entries[2].recognitionTiming.processingMs, null);
  assert.equal(saved.entries[2].recognitionTiming.queueMs, 0);
  assert.equal(saved.entries[2].recognitionTiming.audioDurationMs, 180000);
  assert.equal(saved.entries[0].recognitionComparison, undefined);
  assert.equal(saved.entries[3].heardText, 'otra frase no pero no pero');
  assert.deepEqual(saved.entries[3].recognitionAttempt, { source: 'repeated_line', text: 'no pero' });
  assert.equal(saved.entries[3].recognitionDiagnostics.firstTextMs, 2000);
  assert.equal(saved.entries[3].recognitionDiagnostics.retryCount, 1);
  assert.equal(saved.entries[4].recognitionDiagnostics.firstTextMs, null);
  assert.equal(saved.entries[4].recognitionAttempt, undefined);
  assert.equal(saved.entries[5].heardText.length, 1200);
  assert.deepEqual(saved.entries[5].recognitionAttempt, { source: 'repeated_line', text: 'no pero', rawTranscriptTruncated: true });
  assert.equal(JSON.stringify(saved).includes('PRIVATE_'), false);
});
