const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { setImmediate: settle } = require('node:timers/promises');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createLocalSpeechRecognitionConstructor: localConstructor } = require('../src/utils/localSpeechRecognitionSession.ts');
const { createSpeechRecognitionSession: session } = require('../src/utils/speechRecognitionSession.ts');
const { scoreLineMatch, getAutomaticLineAdvanceDelay: delay } = require('../src/utils/lineMatching.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

const reference = 'Abuela, que pasó? Porque gritas? Pasó algo malo?';
const options = (lineKey = 'actor-1') => ({ enabled: true, lang: 'es-ES', lineKey });
const nextDelay = (snapshot) => delay(reference, snapshot.transcript, snapshot.interimTranscript,
  scoreLineMatch(reference, snapshot.transcript));
const fixture = (t, overrides = {}) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const streams = [], contexts = [], decoders = [];
  class Decoder {
    constructor() { this.listeners = {}; decoders.push(this); }
    on(event, callback) { this.listeners[event] = callback; }
    acceptWaveform() {}
    remove() { this.removed = true; }
    partial(partial) { this.listeners.partialresult({ result: { partial } }); }
    final(text) { this.listeners.result({ result: { text } }); }
  }
  const model = { KaldiRecognizer: Decoder };
  const createStream = () => {
    const track = { readyState: 'live', stop() { this.readyState = 'ended'; this.stoppedAt = Date.now(); } };
    const stream = { getTracks: () => [track] }; streams.push(stream); return stream;
  };
  const node = () => ({ connect() {}, disconnect() { this.disconnected = true; } });
  const Constructor = localConstructor({
    loadModel: async () => model,
    getUserMedia: async () => createStream(),
    createAudioContext: () => {
      const context = { sampleRate: 48000, state: 'running', destination: {},
        createMediaStreamSource: () => node(), createScriptProcessor: () => node(),
        createGain: () => ({ ...node(), gain: { value: 1 } }),
        close() { this.state = 'closed'; return new Promise(() => {}); },
      };
      contexts.push(context); return context;
    },
    ...overrides,
  });
  const recognition = session(Constructor, () => {}, { startTimeoutMs: 120000 });
  t.after(() => recognition.dispose());
  return { recognition, model, streams, contexts, decoders, createStream };
};

test('local word recognition releases capture immediately and never waits for a Safari service end', async (t) => {
  const f = fixture(t);
  f.recognition.configure(options()); await settle();
  f.decoders[0].partial('abuela qué pasó porque gritas pasó algo malo');
  assert.equal(nextDelay(f.recognition.getSnapshot()), 60);
  f.recognition.stop();
  assert.equal(f.streams[0].getTracks()[0].readyState, 'ended');
  assert.equal(f.streams[0].getTracks()[0].stoppedAt, 0);
  assert.equal(f.decoders[0].removed, true);
  assert.equal(f.contexts[0].state, 'closed');
  assert.equal(await f.recognition.waitForInputEnd(), true);
  assert.equal(await f.recognition.waitForEnd(), true);
  assert.equal(Date.now(), 0, 'even a pending AudioContext.close must not delay the reply');
});

test('local recognition accepts a strong score with extra words inside the ending', async (t) => {
  const f = fixture(t);
  f.recognition.configure(options()); await settle();
  const heard = 'Abuela qué pasó porque gritas pasó algo realmente malo';
  f.decoders[0].partial(heard);
  assert.ok(scoreLineMatch(reference, heard).score >= 0.86);
  assert.equal(nextDelay(f.recognition.getSnapshot()), 60);
  f.decoders[0].final(heard);
  assert.equal(nextDelay(f.recognition.getSnapshot()), 0);
});

test('local recognition uses the same tolerant threshold when the last word changes', async (t) => {
  const f = fixture(t);
  const expected = 'Cada mañana abro la tienda, preparo el café y reviso todos los encargos antes de que mis vecinos salgan hacia el trabajo.';
  const heard = 'Cada mañana abro la tienda preparo el café y reviso todos los encargos antes de que mis vecinos salgan hacia el empleo';
  f.recognition.configure(options()); await settle();
  for (const emit of ['partial', 'final']) {
    f.decoders[0][emit](heard);
    const snapshot = f.recognition.getSnapshot();
    const match = scoreLineMatch(expected, snapshot.transcript);
    assert.ok(match.score >= 0.86 && match.score < 1, `expected a sufficient non-exact score, got ${match.score}`);
    assert.equal(delay(expected, snapshot.transcript, snapshot.interimTranscript, match), emit === 'partial' ? 60 : 0);
  }
});

test('a pause before English preserves the Spanish words and accepts the later phonetic result', async (t) => {
  const f = fixture(t);
  const expected = 'Tengo noticias. My Enlgish is getting much better.';
  f.recognition.configure(options()); await settle();
  f.decoders[0].final('tengo noticias');
  t.mock.timers.tick(5000);
  let snapshot = f.recognition.getSnapshot();
  assert.equal(delay(expected, snapshot.transcript, snapshot.interimTranscript,
    scoreLineMatch(expected, snapshot.transcript)), null);
  assert.equal(f.streams[0].getTracks()[0].readyState, 'live');
  f.decoders[0].partial('may english macbeth');
  snapshot = f.recognition.getSnapshot();
  assert.equal(snapshot.transcript, 'tengo noticias may english macbeth');
  assert.equal(delay(expected, snapshot.transcript, snapshot.interimTranscript,
    scoreLineMatch(expected, snapshot.transcript)), 60);
  f.recognition.stop();
  assert.equal(f.streams[0].getTracks()[0].readyState, 'ended');
});

test('multi-second pauses keep the words without advancing before a sufficient match', async (t) => {
  const f = fixture(t);
  f.recognition.configure(options()); await settle();
  f.decoders[0].final('abuela qué pasó');
  t.mock.timers.tick(5000);
  assert.equal(nextDelay(f.recognition.getSnapshot()), null);
  assert.equal(f.streams[0].getTracks()[0].readyState, 'live');
  f.decoders[0].partial('porque gritas');
  assert.equal(nextDelay(f.recognition.getSnapshot()), null);
  f.decoders[0].final('porque gritas');
  t.mock.timers.tick(3000);
  assert.equal(nextDelay(f.recognition.getSnapshot()), null, 'silence and a final decoder event cannot replace a sufficient word match');
  f.decoders[0].partial('pasó algo realmente malo');
  assert.notEqual(nextDelay(f.recognition.getSnapshot()), null);
  assert.equal(f.decoders.length, 1);
});

test('an accepted shorter replica is not vetoed for omitting a literal last word', async (t) => {
  const f = fixture(t);
  f.recognition.configure(options()); await settle();
  f.decoders[0].partial('abuela qué pasó porque gritas pasó algo');
  assert.equal(nextDelay(f.recognition.getSnapshot()), 60);
});

test('six actor/app cycles reopen our own input without poisoning or repeating old transcripts', async (t) => {
  const f = fixture(t);
  for (let index = 0; index < 6; index += 1) {
    f.recognition.configure(options(`actor-${index}`)); await settle();
    const decoder = f.decoders[index];
    assert.equal(f.recognition.getSnapshot().transcript, '');
    decoder.partial(`Frase del actor ${index}`);
    f.recognition.configure({ ...options(`app-${index}`), enabled: false });
    assert.equal(f.streams[index].getTracks()[0].readyState, 'ended');
    assert.equal(await f.recognition.waitForInputEnd(), true);
    decoder.final('Evento atrasado que debe descartarse');
    assert.equal(f.recognition.getSnapshot().transcript, '');
    f.recognition.notifyPlaybackEnd();
  }
  assert.equal(f.streams.length, 6);
  assert.equal(f.decoders.filter((decoder) => decoder.removed).length, 6);
});

test('a cancelled model load stops permission granted later without opening an audio graph', async (t) => {
  let grant;
  const f = fixture(t, { getUserMedia: () => new Promise((resolve) => { grant = resolve; }) });
  f.recognition.configure(options()); f.recognition.stop();
  grant(f.createStream()); await settle();
  assert.equal(f.streams[0].getTracks()[0].readyState, 'ended');
  assert.equal(f.contexts.length, 0);
  assert.equal(f.recognition.getSnapshot().status, 'idle');
});

test('first download can take over fifteen seconds and a retry after failure creates clean input', async (t) => {
  let complete;
  const f = fixture(t, { loadModel: () => new Promise((resolve) => { complete = resolve; }) });
  f.recognition.configure(options()); await settle();
  t.mock.timers.tick(16000);
  assert.equal(f.recognition.getSnapshot().status, 'starting');
  complete(f.model); await settle();
  assert.equal(f.recognition.getSnapshot().isAudioActive, true);
  f.decoders[0].listeners.error({ error: 'decoder failed' });
  assert.equal(f.recognition.getSnapshot().status, 'error');
  assert.equal(f.streams[0].getTracks()[0].readyState, 'ended');
  f.recognition.restart(); await settle(); complete(f.model); await settle();
  f.decoders[1].partial('prueba de micro');
  assert.equal(f.recognition.getSnapshot().transcript, 'prueba de micro');
});

test('backgrounding closes the local microphone and returning restores words without a speech cue', async (t) => {
  const f = fixture(t);
  f.recognition.configure(options()); await settle();
  f.decoders[0].final('abuela qué pasó');
  f.recognition.setPageVisible(false);
  assert.equal(f.streams[0].getTracks()[0].readyState, 'ended');
  t.mock.timers.tick(30000);
  f.recognition.setPageVisible(true); await settle();
  f.decoders[1].partial('porque gritas pasó algo malo');
  assert.equal(f.recognition.getSnapshot().transcript, 'abuela qué pasó porque gritas pasó algo malo');
  assert.equal(f.decoders.length, 2);
});

test('microphone permission is requested in the activating tap, independently of model download', async (t) => {
  let inTap = false, requestedInTap = false;
  const f = fixture(t, { getUserMedia: async () => { requestedInTap = inTap; return f.createStream(); } });
  inTap = true; f.recognition.activate({ lang: 'es-ES', lineKey: 'prepare' }); inTap = false;
  await settle();
  assert.equal(requestedInTap, true);
  assert.equal(f.recognition.getSnapshot().isAudioActive, true);
});
