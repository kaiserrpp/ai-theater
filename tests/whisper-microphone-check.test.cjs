const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const { setImmediate: settle } = require('node:timers/promises');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { createWhisperMicrophoneCheck } = require('../src/utils/whisperMicrophoneCheck.ts');
const { createLocalSpeechRecognitionConstructor } = require('../src/utils/localSpeechRecognitionSession.ts');
const { createSpeechRecognitionSession } = require('../src/utils/speechRecognitionSession.ts');
const { hasRecognizedMicrophoneCheck: verified } = require('../src/utils/speechRecognitionCompatibility.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader; else delete require.extensions['.ts'];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const fixture = t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const streams = [], processors = [], calls = [];
  let cancelled = 0;
  class Decoder {
    constructor(rate) {
      const decoder = createWhisperMicrophoneCheck(rate, audio => {
        assert(streams.every(track => track.stopped), 'capture must be closed before inference');
        const pending = deferred(); calls.push({ audio, pending }); return pending.promise;
      }, () => { cancelled++; });
      Object.assign(this, decoder);
    }
  }
  const node = () => ({ connect() {}, disconnect() {} });
  const Constructor = createLocalSpeechRecognitionConstructor({
    loadModel: async () => ({ KaldiRecognizer: Decoder }),
    getUserMedia: async () => { const track = { stop() { this.stopped = true; } }; streams.push(track); return { getTracks: () => [track] }; },
    createAudioContext: () => ({ sampleRate: 48000, state: 'running', destination: {}, createMediaStreamSource: node,
      createGain: () => ({ ...node(), gain: { value: 0 } }), createScriptProcessor: () => { const p = node(); processors.push(p); return p; }, close: async () => {} }),
  });
  const session = createSpeechRecognitionSession(Constructor, () => {});
  t.after(session.dispose);
  return { session, calls, streams, cancelled: () => cancelled,
    start: async () => { session.activate({ lang: 'es-ES', lineKey: 'prepare' }); await settle(); },
    feed: (seconds, value = 0.2) => processors.at(-1).onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(Math.round(seconds * 48000)).fill(value) } }),
  };
};

test('Whisper setup records the entire phrase once and closes capture before decoding, without partial guesses', async t => {
  const f = fixture(t); await f.start();
  f.feed(0.8); t.mock.timers.tick(15000); await settle();
  assert.equal(f.calls.length, 0); assert.equal(f.session.getSnapshot().transcript, '');
  f.feed(3.2);
  assert.equal(f.session.finishInput(), true);
  assert.equal(f.session.getSnapshot().status, 'processing');
  assert.equal(f.session.getSnapshot().isAudioActive, false);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].audio.length, 4 * 16000);
  assert.equal(f.session.finishInput(), false, 'repeated taps cannot submit a second inference');
  f.calls[0].pending.resolve({ text: 'Hola, esta es una prueba de micro para empezar el ensayo.' }); await settle();
  assert.equal(verified(f.session.getSnapshot().finalTranscript), true);
  assert.equal(f.session.getSnapshot().status, 'idle');
  t.mock.timers.tick(10000); await settle();
  assert.equal(f.streams.length, 1, 'completed checks never reopen their microphone on a timer');
});

test('a wrong result remains a failed check; a retry discards its text and audio instead of accumulating them', async t => {
  const f = fixture(t); await f.start(); f.feed(2); f.session.finishInput();
  f.calls[0].pending.resolve({ text: 'Pero vamos a demicro, lo va de mi bro.' }); await settle();
  assert.equal(verified(f.session.getSnapshot().transcript), false);
  t.mock.timers.tick(10000); await settle(); assert.equal(f.calls.length, 1);
  await f.start(); assert.equal(f.session.getSnapshot().transcript, '');
  f.feed(1); f.session.finishInput(); assert.equal(f.calls[1].audio.length, 16000);
  f.calls[1].pending.resolve({ text: 'prueba de micro' }); await settle();
  assert.equal(f.session.getSnapshot().transcript, 'prueba de micro');
  assert.equal(verified(f.session.getSnapshot().transcript), true);
});

test('silence and an early finish remain errors, and leaving a pending check ignores its late words', async t => {
  const f = fixture(t); await f.start(); f.feed(2, 0); assert.equal(f.session.finishInput(), false);
  assert.equal(f.session.getSnapshot().status, 'error'); assert.equal(f.calls.length, 0);
  await f.start(); f.feed(2); f.session.finishInput();
  await f.start(); assert.equal(f.session.getSnapshot().transcript, '');
  f.calls[0].pending.resolve({ text: 'prueba de micro' }); await settle();
  assert.equal(f.session.getSnapshot().transcript, ''); assert.equal(verified(f.session.getSnapshot().transcript), false);
  assert(f.cancelled() >= 2);
});

test('an unattended check is bounded and fails with a fresh retry rather than decoding endless room noise', async t => {
  const f = fixture(t); await f.start(); f.feed(30.1);
  assert.equal(f.calls.length, 0); assert.equal(f.session.getSnapshot().status, 'error');
  assert(f.streams.every(track => track.stopped));
  await f.start(); f.feed(1); f.session.finishInput();
  assert.equal(f.calls[0].audio.length, 16000);
});
