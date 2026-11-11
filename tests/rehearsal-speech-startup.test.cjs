const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
const previousLoad = Module._load;
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
Module._load = function (name, ...args) {
  if (name === 'expo-speech') return { speak() {}, stop() {} };
  return previousLoad.call(this, name, ...args);
};
const { prepareRehearsalSpeech: prepare, speakRehearsalSpeech: speak, stopRehearsalSpeech: stop } = require('../src/utils/rehearsalSpeech.ts');
const { createSpeechRecognitionSession: createSession } = require('../src/utils/speechRecognitionSession.ts');
Module._load = previousLoad;
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

const fixture = (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const previousWindow = global.window;
  const utterances = [], events = [], captures = [];
  let capturing = false, aborts = 0;
  const spanishVoice = { lang: 'es-ES', name: 'Spanish' };
  class Utterance {
    constructor(text) { this.text = text; events.push({ kind: 'prepared', at: Date.now() }); }
  }
  const synth = {
    speaking: false, pending: false,
    cancel() { events.push({ kind: 'cancel', at: Date.now() }); this.speaking = this.pending = false; },
    resume() { events.push({ kind: 'resume', at: Date.now() }); },
    getVoices: () => [spanishVoice],
    speak(utterance) {
      assert.equal(capturing, false, 'speech must never overlap live recognition');
      events.push({ kind: 'speak', at: Date.now() });
      utterances.push(utterance);
      this.speaking = true;
      utterance.onstart?.();
    },
  };
  class Recognition {
    constructor() { captures.push(this); }
    start() { capturing = true; }
    abort() { aborts += 1; capturing = false; }
    end() { capturing = false; this.onend?.(); }
    finishInput() {
      capturing = false;
      this.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'Frase terminada' } }] });
      this.onspeechend?.();
      this.onaudioend?.();
    }
  }
  global.window = { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance };
  const session = createSession(Recognition, () => {}, { naturalEnd: true, usage: { started: false } });
  t.after(() => { stop(); session.dispose(); global.window = previousWindow; });
  const finish = () => { synth.speaking = false; utterances.at(-1).onend?.(); };
  return { synth, utterances, events, captures, session, finish, aborts: () => aborts,
    count: (kind) => events.filter((event) => event.kind === kind).length };
};

test('prepare during capture, then start in the same turn that native recognition ends, without a playback timer', async (t) => {
  const f = fixture(t);
  f.session.configure({ enabled: true, lang: 'es-ES', lineKey: 'actor' });
  const prepared = prepare('La respuesta del compañero.', {});
  assert.equal(f.count('prepared'), 1);
  assert.equal(f.count('cancel'), 0);
  assert.equal(f.count('resume'), 0);
  assert.equal(f.count('speak'), 0);
  f.session.stop();
  const inputClosed = f.session.waitForEnd().then((ended) => { if (ended) prepared.start(1.05); });
  t.mock.timers.tick(900);
  assert.equal(f.count('speak'), 0);
  f.captures[0].end();
  await inputClosed;
  assert.deepEqual(f.events.filter((event) => event.kind === 'speak'), [{ kind: 'speak', at: 900 }]);
  assert.equal(f.count('prepared'), 1, 'reuse the utterance prepared before waiting');
  assert.equal(f.utterances[0].voice.lang, 'es-ES');
  assert.equal(f.utterances[0].rate, 1.05, 'musical timeline rate is applied at actual start');
  assert.equal(f.count('cancel'), 0);
  assert.equal(f.aborts(), 0);
});

test('consecutive completed lines and idle effect cleanups never reset the speech engine', (t) => {
  const f = fixture(t);
  for (const text of ['Hola, Usnavi.', '¿Cómo estás?', 'Vamos a empezar.']) {
    stop(); // Previous effect cleanup.
    stop(); // Next effect setup.
    speak(text, {});
    f.finish();
  }
  assert.equal(f.count('speak'), 3);
  assert.equal(f.count('cancel'), 0);
  assert.deepEqual(f.events.filter((event) => event.kind === 'speak').map((event) => event.at), [0, 0, 0]);
});

test('preparing and cancelling an obsolete line never interrupts the current speech or starts it later', (t) => {
  const f = fixture(t);
  speak('La frase actual.', {});
  const oldDone = f.utterances[0].onend;
  const prepared = prepare('La frase que se ha saltado.', {});
  prepared.cancel();
  prepared.start();
  assert.equal(f.count('cancel'), 0);
  assert.equal(f.utterances.length, 1);
  oldDone();
  assert.equal(f.utterances.length, 1);
});

test('leaving while recognition closes cannot start the prepared voice after the delayed native end', async (t) => {
  const f = fixture(t);
  f.session.configure({ enabled: true, lang: 'es-ES', lineKey: 'actor' });
  const prepared = prepare('Esta frase se canceló.', {});
  f.session.stop();
  const pending = f.session.waitForEnd().then((ended) => { if (ended) prepared.start(); });
  prepared.cancel();
  t.mock.timers.tick(1000);
  f.captures[0].end(); await pending;
  assert.equal(f.utterances.length, 0);
  assert.equal(f.count('cancel'), 0);
  assert.equal(f.aborts(), 0);
});

test('replacing an active line cancels once and its old callbacks cannot affect the new voice', (t) => {
  const f = fixture(t);
  let oldCompleted = 0, nextCompleted = 0;
  const first = prepare('Anterior.', { onDone: () => { oldCompleted += 1; } });
  first.start();
  const staleDone = f.utterances[0].onend;
  const staleError = f.utterances[0].onerror;
  const second = prepare('Nueva.', { onDone: () => { nextCompleted += 1; } });
  second.start(); second.start();
  first.cancel();
  staleDone(); staleError();
  assert.equal(f.count('cancel'), 1);
  assert.equal(f.utterances.length, 2);
  assert.equal(oldCompleted, 0);
  f.finish();
  assert.equal(nextCompleted, 1);
  second.cancel();
  t.mock.timers.tick(10000);
  assert.equal(f.count('cancel'), 1);
  assert.equal(f.utterances.length, 2);
});

test('a genuinely stuck browser queue is cleared once, while calibration still speaks within its tap', (t) => {
  const f = fixture(t);
  f.synth.pending = true;
  let inTap = true, startedInTap = false;
  speak('Hola, hola, dime si me oyes.', { onStart: () => { startedInTap = inTap; } });
  inTap = false;
  assert.equal(startedInTap, true);
  assert.equal(f.count('cancel'), 1);
  f.finish();
});

test('the app speaks at natural input completion instead of waiting for delayed native service end', async (t) => {
  const f = fixture(t);
  f.session.configure({ enabled: true, lang: 'es-ES', lineKey: 'actor' });
  const prepared = prepare('¡No! Tengo tu sanguchito.', {});
  f.session.stop();
  const pending = f.session.waitForInputEnd().then((ended) => { if (ended) prepared.start(); });
  t.mock.timers.tick(200);
  f.captures[0].finishInput(); await pending;
  assert.deepEqual(f.events.filter((event) => event.kind === 'speak'), [{ kind: 'speak', at: 200 }]);
  assert.equal(f.aborts(), 0);
  t.mock.timers.tick(2000);
  f.captures[0].end();
  assert.equal(f.count('speak'), 1);
  assert.equal(f.aborts(), 0);
  f.finish();
});

test('a short early reply keeps the next actor turn closed until the previous native service has ended', async (t) => {
  const f = fixture(t);
  f.session.configure({ enabled: true, lang: 'es-ES', lineKey: 'actor' });
  let nextTurnOpened = false, nextInputReady;
  const prepared = prepare('¡No!', { onDone: () => {
    f.session.notifyPlaybackEnd();
    nextInputReady = f.session.waitForEnd().then((ended) => {
      if (!ended) return;
      nextTurnOpened = true;
      f.session.configure({ enabled: true, lang: 'es-ES', lineKey: 'next-actor' });
    });
  } });
  f.session.stop();
  f.captures[0].finishInput();
  assert.equal(await f.session.waitForInputEnd(), true);
  prepared.start();
  t.mock.timers.tick(200); f.finish();
  await Promise.resolve();
  assert.equal(nextTurnOpened, false);
  assert.equal(f.captures.length, 1);
  t.mock.timers.tick(1000); f.captures[0].end(); await nextInputReady;
  assert.equal(nextTurnOpened, true);
  assert.equal(f.captures.length, 2);
  assert.equal(f.aborts(), 0);
});
