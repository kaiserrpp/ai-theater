const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createSpeechRecognitionSession: createSession } = require('../src/utils/speechRecognitionSession.ts');
const { needsNaturalRecognitionEnd: naturalEnd, hasRecognizedMicrophoneCheck: verified } = require('../src/utils/speechRecognitionCompatibility.ts');
const { createRehearsalPreparationSession } = require('../src/utils/rehearsalPreparationSession.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

const options = (overrides = {}) => ({ enabled: true, lang: 'es-ES', lineKey: 'my-line-1', ...overrides });
const result = (text, isFinal = true) => ({ isFinal, 0: { transcript: text } });
const fixture = (t, extra = {}) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const handles = [];
  const cues = [];
  let active = null;
  let poisoned = false;
  class Recognition {
    constructor() { handles.push(this); }
    start() { assert.equal(active, null); active = this; }
    abort() { if (!this.ended) poisoned = true; this.aborted = true; active = null; }
    receive(text, isFinal = true) {
      if (!poisoned) this.onresult?.({ results: [result(text, isFinal)] });
    }
    end() { this.ended = true; active = null; this.onend?.(); }
  }
  const session = createSession(Recognition, () => {}, {
    naturalEnd: true, usage: { started: false },
    prepareRestart: (callbacks) => {
      // A speech prompt with a live recognizer reproduces another failure
      // reported on iOS. Never overlap the two operations.
      assert.equal(active, null);
      const cue = { ...callbacks, cancelled: false };
      cues.push(cue);
      return () => { cue.cancelled = true; };
    },
    ...extra,
  });
  t.after(() => session.dispose());
  return { session, handles, cues, poisoned: () => poisoned };
};

test('the iOS 27 policy also recognizes a frozen iPhone OS user agent and standalone mode', () => {
  assert.equal(naturalEnd({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Version/27.2 Mobile Safari/604.1' }), true);
  assert.equal(naturalEnd({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Mobile/15E148' }), true);
  assert.equal(naturalEnd({ userAgent: 'Version/27.2 Safari/605', platform: 'MacIntel', maxTouchPoints: 5 }), true);
  assert.equal(naturalEnd({ userAgent: 'iPhone OS 18_7 Version/18.7 Mobile Safari/604.1' }), false);
  assert.equal(naturalEnd({ userAgent: 'Android Chrome/157.0 Mobile' }), false);
  assert.equal(naturalEnd({ userAgent: 'Windows NT 10.0 Chrome/157.0 Safari/537.36' }), false);
});

test('opening the microphone and confirming speaker output cannot verify speech recognition', () => {
  const preparation = createRehearsalPreparationSession();
  preparation.confirmSpeaker();
  preparation.rememberCalibration({ status: 'ready', noiseFloor: 0.01, voiceLevel: 0.1, voiceThreshold: 0.02 });
  for (const text of ['', 'hola hola dime si me oyes', 'sonando la prueba']) {
    preparation.confirmRecognitionOutput(text);
    assert.equal(preparation.getSnapshot().recognitionOutputConfirmed, false);
  }
  preparation.confirmRecognitionOutput('¡Prueba de micrófono!');
  assert.equal(preparation.getSnapshot().recognitionOutputConfirmed, true);
  assert.equal(verified('Prueba del micro'), true);
});

test('six actor/voice cycles preserve a recognizer which fails permanently if aborted', async (t) => {
  const f = fixture(t);
  for (let turn = 0; turn < 6; turn += 1) {
    f.session.configure(options({ lineKey: `my-line-${turn}` }));
    if (f.cues.length && f.session.getSnapshot().status === 'preparing') f.cues.at(-1).onDone();
    const current = f.handles.at(-1);
    assert.equal(current.continuous, false);
    current.onaudiostart();
    current.receive(`Mi frase ${turn}`);
    assert.equal(f.session.getSnapshot().transcript, `Mi frase ${turn}`);
    f.session.stop();
    let closed = false;
    const idle = f.session.waitForEnd().then((ended) => { closed = ended; });
    await Promise.resolve();
    assert.equal(closed, false);
    assert.equal(current.aborted, undefined);
    current.end();
    await idle;
    assert.equal(closed, true);
    // The next app line/scene has finished speaking with input closed.
    f.session.notifyPlaybackEnd();
  }
  assert.equal(f.handles.length, 6);
  assert.equal(f.poisoned(), false);
});

test('a pause in one long replica can resume after a cue without losing already recognized words', (t) => {
  const f = fixture(t);
  f.session.configure(options());
  f.handles[0].onaudiostart();
  f.handles[0].receive('Voy a');
  f.handles[0].end();
  t.mock.timers.tick(250);
  assert.equal(f.session.getSnapshot().status, 'preparing');
  assert.equal(f.handles.length, 1);
  f.cues[0].onDone();
  f.handles[1].receive('buscarla');
  assert.equal(f.session.getSnapshot().transcript, 'Voy a buscarla');
  assert.equal(f.poisoned(), false);
});

test('changing a line or language with an old partial result waits for native end and keeps the first new words', (t) => {
  const f = fixture(t);
  f.session.configure(options());
  f.handles[0].receive('Old partial', false);
  f.session.configure(options({ lang: 'en-US', lineKey: 'my-line-2' }));
  assert.equal(f.session.getSnapshot().status, 'finishing');
  assert.equal(f.handles[0].aborted, undefined);
  f.handles[0].receive('Discarded final');
  assert.equal(f.session.getSnapshot().transcript, '');
  f.handles[0].end();
  t.mock.timers.tick(250);
  f.cues[0].onDone();
  assert.equal(f.handles[1].lang, 'en-US');
  f.handles[1].receive('Ey, Sonny');
  assert.equal(f.session.getSnapshot().transcript, 'Ey, Sonny');
  assert.equal(f.poisoned(), false);
});

test('an audio-start event with no actual transcript eventually offers recovery instead of listening forever', (t) => {
  const f = fixture(t);
  f.session.configure(options());
  f.handles[0].onstart(); f.handles[0].onaudiostart();
  assert.equal(f.session.getSnapshot().hasReceivedTranscript, false);
  t.mock.timers.tick(20000);
  assert.equal(f.session.getSnapshot().status, 'error');
  assert.equal(f.session.getSnapshot().errorCode, 'no-recognition-results');
  assert.match(f.session.getSnapshot().error, /no ha entregado palabras/);
  assert.equal(f.handles[0].aborted, undefined);
  f.handles[0].end();
  t.mock.timers.tick(10000);
  assert.equal(f.handles.length, 1);
  assert.equal(f.session.getSnapshot().status, 'error');
});

test('a cancelled cue cannot start the microphone under a newer app speech', (t) => {
  const f = fixture(t);
  f.session.configure(options()); f.handles[0].end();
  t.mock.timers.tick(250);
  f.session.stop();
  assert.equal(f.cues[0].cancelled, true);
  f.cues[0].onDone();
  t.mock.timers.tick(5000);
  assert.equal(f.handles.length, 1);
});

test('new rehearsals in the same document prepare the next recognition without repeating volume calibration', (t) => {
  const f = fixture(t, { usage: { started: true } });
  f.session.activate({ lang: 'es-ES', lineKey: 'prepare:audition' });
  assert.equal(f.handles.length, 0);
  assert.equal(f.session.getSnapshot().status, 'preparing');
  f.cues[0].onDone();
  f.handles[0].receive('prueba de micro');
  assert.equal(verified(f.session.getSnapshot().transcript), true);
});

test('waiting for a stuck native end has a deadline without poisoning the service with abort', async (t) => {
  const f = fixture(t);
  f.session.configure(options()); f.handles[0].onaudiostart(); f.session.stop();
  const ended = f.session.waitForEnd();
  t.mock.timers.tick(12000);
  assert.equal(await ended, false);
  assert.equal(f.handles[0].aborted, undefined);
});
