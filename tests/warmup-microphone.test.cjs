const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { setImmediate: settle } = require('node:timers/promises');
const oldLoader = require.extensions['.ts'];
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { createWarmupMicrophoneSession, usesWarmupMicrophoneSession } = require('../src/utils/warmupMicrophoneSession.ts');
const { createLocalSpeechRecognitionConstructor } = require('../src/utils/localSpeechRecognitionSession.ts');
const { createSpeechRecognitionSession } = require('../src/utils/speechRecognitionSession.ts');
if (oldLoader) require.extensions['.ts'] = oldLoader; else delete require.extensions['.ts'];

const fixture = (overrides = {}) => {
  const streams = [], contexts = [], decoders = [], sources = [];
  let requests = 0;
  const stream = () => {
    const track = { enabled: true, readyState: 'live', stop() { this.readyState = 'ended'; } };
    const result = { getTracks: () => [track], getAudioTracks: () => [track], clone: stream };
    streams.push(result); return result;
  };
  const node = () => ({ connect() {}, disconnect() { this.disconnected = true; } });
  class Decoder {
    constructor() { this.listeners = {}; decoders.push(this); }
    on(event, callback) { this.listeners[event] = callback; }
    acceptWaveform() {}
    remove() { this.removed = true; }
    final(text) { this.listeners.result({ result: { text } }); }
  }
  const pool = createWarmupMicrophoneSession({
    getUserMedia: () => { requests++; return overrides.getUserMedia ? overrides.getUserMedia(stream) : Promise.resolve(stream()); },
    createAudioContext: () => {
      const context = { state: 'suspended', sampleRate: 48000, destination: {},
        resume() { this.resumes = (this.resumes || 0) + 1; this.state = 'running'; return Promise.resolve(); },
        close() { this.state = 'closed'; return Promise.resolve(); },
        createMediaStreamSource(s) { const n = { ...node(), stream: s }; sources.push(n); return n; },
        createScriptProcessor: node, createGain: () => ({ ...node(), gain: { value: 0 } }),
      }; contexts.push(context); return context;
    },
  });
  const Constructor = createLocalSpeechRecognitionConstructor({
    getUserMedia: pool.acquire, createAudioContext: pool.getAudioContext,
    releaseAudioContext: () => {}, loadModel: async () => ({ KaldiRecognizer: Decoder }),
  });
  const session = createSpeechRecognitionSession(Constructor, () => {}, { startTimeoutMs: 120000 });
  return { pool, session, streams, contexts, sources, decoders, requests: () => requests };
};

test('all seven warmup rests share one disabled root and one unlocked context, with fresh isolated command decoders', async (t) => {
  const f = fixture(); t.after(() => { f.session.dispose(); f.pool.release(); });
  const prepared = f.pool.prepare();
  assert.equal(f.requests(), 1, 'request happens synchronously in the initial tap');
  assert.equal(f.contexts[0].resumes, 1, 'context unlock also happens in that tap');
  await prepared;
  assert.equal(f.streams[0].getTracks()[0].enabled, false, 'no input while the exercise plays');
  for (let index = 0; index < 7; index++) {
    const lineKey = `rest-${index}`;
    f.session.configure({ enabled: true, lang: 'es-ES', lineKey }); await settle();
    const lease = f.streams.at(-1), source = f.sources.at(-1), decoder = f.decoders.at(-1);
    assert.equal(lease.getTracks()[0].enabled, true);
    assert.equal(f.session.getSnapshot().status, 'listening');
    assert.equal(f.session.getSnapshot().transcript, '');
    decoder.final('quiero agua'); decoder.final('adelante');
    assert.deepEqual(f.session.getSnapshot().lastUtterance, { text: 'adelante', isFinal: true, lineKey });
    f.session.stop();
    assert.equal(await f.session.waitForInputEnd(), true);
    assert.equal(await f.session.waitForEnd(), true);
    assert.equal(lease.getTracks()[0].readyState, 'ended', 'rest clone closed before piano/guide');
    assert.equal(source.disconnected, true);
    assert.equal(decoder.removed, true);
    assert.equal(f.streams[0].getTracks()[0].readyState, 'live');
    assert.equal(f.streams[0].getTracks()[0].enabled, false);
    assert.equal(f.contexts[0].state, 'running');
  }
  assert.equal(f.requests(), 1);
  assert.equal(f.contexts.length, 1);
  f.pool.release();
  assert.ok(f.streams.every(s => s.getTracks()[0].readyState === 'ended'));
  assert.equal(f.contexts[0].state, 'closed');
});

test('denied permission is not requested at every rest; only an explicit retry may ask again', async (t) => {
  let denied = true;
  const f = fixture({ getUserMedia: stream => denied ? Promise.reject(Object.assign(new Error('Denied'), { name: 'NotAllowedError' })) : Promise.resolve(stream()) });
  t.after(() => { f.session.dispose(); f.pool.release(); });
  await assert.rejects(f.pool.prepare(), { name: 'NotAllowedError' });
  for (let i = 0; i < 7; i++) await assert.rejects(f.pool.acquire(), { name: 'NotAllowedError' });
  assert.equal(f.requests(), 1);
  denied = false;
  await f.pool.prepare(true);
  const lease = await f.pool.acquire();
  assert.equal(lease.getTracks()[0].enabled, true);
  assert.equal(f.requests(), 2);
});

test('late permission after cancelling is stopped and cannot replace a newer warmup input', async () => {
  const grants = [];
  const f = fixture({ getUserMedia: stream => new Promise(resolve => grants.push(() => resolve(stream()))) });
  const old = f.pool.prepare();
  f.pool.release();
  const current = f.pool.prepare();
  grants[1](); await current;
  const root = f.streams[0];
  grants[0](); await assert.rejects(old, /cancelado/);
  assert.equal(f.streams[1].getTracks()[0].readyState, 'ended');
  const lease = await f.pool.acquire();
  assert.equal(root.getTracks()[0].readyState, 'live');
  assert.equal(lease.getTracks()[0].readyState, 'live');
  assert.equal(f.requests(), 2);
  f.pool.release();
});

test('a cancelled pending rest cannot stop the input of the next rest', async (t) => {
  const f = fixture(); t.after(() => { f.session.dispose(); f.pool.release(); });
  await f.pool.prepare();
  f.session.configure({ enabled: true, lang: 'es-ES', lineKey: 'old' });
  f.session.stop();
  f.session.configure({ enabled: true, lang: 'es-ES', lineKey: 'new' });
  await settle();
  assert.equal(f.streams[1].getTracks()[0].readyState, 'ended');
  assert.equal(f.streams[2].getTracks()[0].readyState, 'live');
  assert.equal(f.session.getSnapshot().status, 'listening');
  f.decoders.at(-1).final('siguiente');
  assert.equal(f.session.getSnapshot().lastUtterance.lineKey, 'new');
});

test('stop, background or voice opt-out releases every input and subsequent workout has its own activation', async (t) => {
  const f = fixture(); t.after(() => { f.session.dispose(); f.pool.release(); });
  await f.pool.prepare();
  f.session.configure({ enabled: true, lang: 'es-ES', lineKey: 'rest' }); await settle();
  f.session.setPageVisible(false); f.pool.release();
  assert.ok(f.streams.every(s => s.getTracks()[0].readyState === 'ended'));
  assert.equal(f.contexts[0].state, 'closed');
  f.pool.release(); // repeated cleanup is safe
  await f.pool.prepare();
  f.session.setPageVisible(true); await settle();
  assert.equal(f.requests(), 2);
  assert.equal(f.contexts.length, 2);
  assert.equal(f.session.getSnapshot().status, 'listening');
});

test('warmup pooling covers all iPhone/iPad browsers while keeping native prototypes and other browsers unchanged', () => {
  for (const userAgent of ['iPhone Version/17.0 Mobile Safari', 'iPhone Version/27.0 Mobile Safari', 'iPhone CriOS/140.0 Mobile', 'iPad Mobile']) {
    assert.equal(usesWarmupMicrophoneSession({ userAgent }, false), true);
    assert.equal(usesWarmupMicrophoneSession({ userAgent }, true), false);
  }
  assert.equal(usesWarmupMicrophoneSession({ platform: 'MacIntel', maxTouchPoints: 5 }, false), true);
  assert.equal(usesWarmupMicrophoneSession({ userAgent: 'Android Chrome' }, false), false);
  assert.equal(usesWarmupMicrophoneSession({ platform: 'MacIntel', maxTouchPoints: 0 }, false), false);
  assert.equal(usesWarmupMicrophoneSession(null, false), false);
});
