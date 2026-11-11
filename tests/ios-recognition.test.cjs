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
const { scoreLineMatch, getAutomaticLineAdvanceDelay: advanceDelay } = require('../src/utils/lineMatching.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

const options = (overrides = {}) => ({ enabled: true, lang: 'es-ES', lineKey: 'my-line-1', ...overrides });
const result = (text, isFinal = true) => ({ isFinal, 0: { transcript: text } });
const fixture = (t, extra = {}) => {
  const { onChange = () => {}, ...sessionOptions } = extra;
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
    finishInput(text, speechFirst = false) {
      active = null;
      if (speechFirst) this.onspeechend?.();
      this.receive(text);
      if (!speechFirst) this.onspeechend?.();
      this.audioEnd();
    }
    audioEnd() { active = null; this.onaudioend?.(); }
    interrupt(delivery = 'end') {
      this.ended = true; active = null;
      if (delivery === 'end') this.onend?.();
      if (delivery === 'error') this.onerror?.({ error: 'aborted', message: 'Page is no longer visible' });
    }
  }
  const session = createSession(Recognition, onChange, {
    naturalEnd: true, usage: { started: false },
    prepareRestart: (callbacks) => {
      // A speech prompt with a live recognizer reproduces another failure
      // reported on iOS. Never overlap the two operations.
      assert.equal(active, null);
      const cue = { ...callbacks, cancelled: false };
      cues.push(cue);
      return () => { cue.cancelled = true; };
    },
    ...sessionOptions,
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

test('a synchronous Safari start rejection leaves no phantom capture blocking the explicit retry', () => {
  const handles = [];
  let allowed = false;
  let aborts = 0;
  class Recognition {
    constructor() { handles.push(this); }
    start() { if (!allowed) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); }
    abort() { aborts += 1; }
  }
  const session = createSession(Recognition, () => {}, { naturalEnd: true, usage: { started: false } });
  session.activate({ lang: 'es-ES', lineKey: 'prepare' });
  assert.equal(session.getSnapshot().status, 'error');
  assert.equal(aborts, 0);
  allowed = true;
  session.restart();
  assert.equal(handles.length, 2);
  handles[1].onresult({ results: [result('prueba de micro')] });
  assert.equal(session.getSnapshot().hasReceivedTranscript, true);
  assert.equal(session.getSnapshot().transcript, 'prueba de micro');
  session.dispose();
});

for (const delivery of ['end', 'error', 'none']) {
  test(`returning from a locked/background page restores words after native ${delivery} callbacks`, (t) => {
    const f = fixture(t);
    f.session.configure(options());
    f.handles[0].receive('Voy a', false);
    const staleError = f.handles[0].onerror;
    const staleResult = f.handles[0].onresult;
    const staleEnd = f.handles[0].onend;
    f.session.setPageVisible(false);
    f.handles[0].interrupt(delivery);
    f.session.configure(options({ enabled: false }));
    t.mock.timers.tick(120000);
    assert.equal(f.session.getSnapshot().error, null);
    assert.equal(f.handles.length, 1);
    assert.equal(f.cues.length, 0);
    f.session.setPageVisible(true);
    f.session.configure(options());
    assert.equal(f.session.getSnapshot().status, 'preparing');
    f.cues[0].onDone();
    staleError({ error: 'not-allowed', message: 'Page is not visible to user' });
    staleResult({ results: [result('NO DEBE APARECER')] });
    staleEnd();
    f.handles[1].receive('buscarla');
    assert.equal(f.session.getSnapshot().transcript, 'Voy a buscarla');
    assert.equal(f.session.getSnapshot().error, null);
    assert.equal(f.handles.length, 2);
    assert.equal(f.poisoned(), false);
    assert.equal(f.handles[0].aborted, undefined);
  });
}

test('backgrounding during a restart cue cancels it and cannot open a hidden capture later', (t) => {
  const f = fixture(t);
  f.session.configure(options()); f.handles[0].end();
  t.mock.timers.tick(250);
  f.session.setPageVisible(false);
  assert.equal(f.cues[0].cancelled, true);
  f.cues[0].onDone();
  t.mock.timers.tick(30000);
  assert.equal(f.handles.length, 1);
  assert.equal(f.session.getSnapshot().status, 'suspended');
  f.session.setPageVisible(true);
  f.cues[1].onDone();
  f.handles[1].receive('Sigo aquí');
  assert.equal(f.session.getSnapshot().transcript, 'Sigo aquí');
});

test('WebKit can report page invisibility before the DOM visibility event without blocking recovery', (t) => {
  const f = fixture(t);
  f.session.configure(options());
  f.handles[0].receive('Sigo', false);
  f.handles[0].interrupt('none');
  f.handles[0].onerror({ error: 'not-allowed', message: 'Page is not visible to user' });
  assert.equal(f.session.getSnapshot().status, 'suspended');
  assert.equal(f.session.getSnapshot().error, null);
  f.session.setPageVisible(false);
  t.mock.timers.tick(30000);
  f.session.setPageVisible(true);
  f.cues[0].onDone();
  f.handles[1].receive('ensayando');
  assert.equal(f.session.getSnapshot().transcript, 'Sigo ensayando');
  assert.equal(f.poisoned(), false);
});

test('returning to Safari does not undo a manual pause or a real permission failure', (t) => {
  const f = fixture(t);
  f.session.configure(options());
  f.handles[0].onerror({ error: 'not-allowed', message: 'Microphone permission check has failed' });
  f.session.setPageVisible(false); f.handles[0].interrupt('error');
  f.session.setPageVisible(true);
  assert.equal(f.session.getSnapshot().errorCode, 'not-allowed');
  assert.equal(f.cues.length, 0);
  f.session.configure(options({ enabled: false }));
  f.session.setPageVisible(false); f.session.setPageVisible(true);
  assert.equal(f.handles.length, 1);
  f.session.configure(options());
  assert.equal(f.cues.length, 0);
  f.session.restart(); f.cues[0].onDone();
  f.handles[1].receive('Ahora sí');
  assert.equal(f.session.getSnapshot().transcript, 'Ahora sí');
  f.session.stop(); f.handles[1].end();
  f.session.setPageVisible(false); f.session.setPageVisible(true);
  t.mock.timers.tick(30000);
  assert.equal(f.handles.length, 2);
  assert.equal(f.cues.length, 1);
});

test('an initially hidden page cannot start recognition until it is shown', (t) => {
  const f = fixture(t, { pageVisible: false });
  f.session.activate({ lang: 'es-ES', lineKey: 'my-line-1' });
  t.mock.timers.tick(30000);
  assert.equal(f.handles.length, 0);
  assert.equal(f.session.getSnapshot().error, null);
  f.session.setPageVisible(true);
  assert.equal(f.handles.length, 1);
  f.handles[0].receive('Hola');
  assert.equal(f.session.getSnapshot().transcript, 'Hola');
});

test('the photographed complete Usnavi turn advances before the restart cue instead of waiting for more words', async (t) => {
  const reference = 'Abuela, que pasó? Porque gritas? Pasó algo malo?';
  const heard = 'Abuela qué pasó por qué gritas pasa algo malo Philip';
  let advances = 0;
  let pending = null;
  const f = fixture(t, { onChange: (snapshot) => {
    if (advances) return;
    if (pending !== null) clearTimeout(pending);
    const delay = advanceDelay(reference, snapshot.transcript, snapshot.interimTranscript,
      scoreLineMatch(reference, snapshot.transcript));
    if (delay !== null) pending = setTimeout(() => {
      advances += 1; f.session.stop();
    }, delay);
  } });
  f.session.configure(options());
  f.handles[0].receive(heard, false);
  f.handles[0].end();
  t.mock.timers.tick(250);
  assert.equal(advances, 1);
  assert.equal(f.cues.length, 0);
  assert.equal(f.handles.length, 1);
  assert.equal(await f.session.waitForEnd(), true);
  f.session.notifyPlaybackEnd();
  f.session.configure(options({ lineKey: 'next-actor-turn' }));
  assert.equal(f.handles.length, 2);
  assert.equal(f.cues.length, 0);
  assert.equal(f.poisoned(), false);
});

test('natural end settles the last provisional words so a complete ending is evaluated before restarting', (t) => {
  const reference = 'Cada mañana abro la tienda, preparo el café y reviso todos los encargos antes de que mis vecinos salgan hacia el trabajo.';
  const heard = 'Siempre preparo un café y reviso los encargos antes de que mis vecinos salgan hacia el trabajo Philip';
  const f = fixture(t);
  f.session.configure(options());
  f.handles[0].receive(heard, false);
  const partial = f.session.getSnapshot();
  assert.equal(advanceDelay(reference, partial.transcript, partial.interimTranscript,
    scoreLineMatch(reference, partial.transcript)), null);
  f.handles[0].end();
  const settled = f.session.getSnapshot();
  assert.equal(settled.transcript, heard);
  assert.equal(settled.finalTranscript, heard);
  assert.equal(settled.interimTranscript, '');
  assert.equal(advanceDelay(reference, settled.transcript, settled.interimTranscript,
    scoreLineMatch(reference, settled.transcript)), 0);
  f.session.stop();
  t.mock.timers.tick(250);
  assert.equal(f.cues.length, 0);
});

test('a real pause before finishing the replica still resumes listening instead of skipping the remaining words', (t) => {
  const reference = 'Abuela, que pasó? Porque gritas? Pasó algo malo?';
  const f = fixture(t);
  f.session.configure(options());
  f.handles[0].receive('Abuela qué pasó', false);
  f.handles[0].end();
  const settled = f.session.getSnapshot();
  assert.equal(advanceDelay(reference, settled.transcript, settled.interimTranscript,
    scoreLineMatch(reference, settled.transcript)), null);
  t.mock.timers.tick(250);
  assert.equal(f.cues.length, 1);
  f.cues[0].onDone();
  f.handles[1].receive('Por qué gritas pasó algo malo');
  const completed = f.session.getSnapshot();
  assert.notEqual(advanceDelay(reference, completed.transcript, completed.interimTranscript,
    scoreLineMatch(reference, completed.transcript)), null);
  assert.equal(f.poisoned(), false);
});

for (const speechFirst of [false, true]) {
  test(`final result plus speechend cannot release playback before audioend (${speechFirst ? 'speech' : 'result'} first)`, async (t) => {
    const f = fixture(t);
    f.session.configure(options());
    const current = f.handles[0];
    current.receive('Mi frase', false);
    f.session.stop();
    let inputReady = false, serviceEnded = false;
    const input = f.session.waitForInputEnd().then((ended) => { inputReady = ended; });
    const service = f.session.waitForEnd().then((ended) => { serviceEnded = ended; });
    if (speechFirst) current.onspeechend?.();
    else current.receive('Mi frase');
    await Promise.resolve();
    assert.equal(inputReady, false, 'one signal alone must not start playback');
    assert.equal(serviceEnded, false);
    if (speechFirst) current.receive('Mi frase');
    else current.onspeechend?.();
    await Promise.resolve();
    assert.equal(inputReady, false, 'even both speech signals leave the physical capture unconfirmed');
    current.audioEnd();
    await input;
    assert.equal(inputReady, true);
    assert.equal(f.session.getInputEndReason(), 'fin de captura');
    assert.equal(serviceEnded, false, 'input completion must not detach or abort the finishing service');
    assert.equal(current.aborted, undefined);
    current.end(); await service;
    assert.equal(serviceEnded, true);
    assert.equal(f.poisoned(), false);
  });
}

test('a short app reply can finish before the native service without an extra cue or overlapping the next recognition', async (t) => {
  const f = fixture(t);
  for (let turn = 0; turn < 6; turn += 1) {
    f.session.configure(options({ lineKey: `actor-${turn}` }));
    const current = f.handles.at(-1);
    current.receive('Mi frase completa', false);
    f.session.stop(); f.session.resetTranscript();
    current.finishInput('Mi frase completa');
    assert.equal(await f.session.waitForInputEnd(), true);
    assert.equal(f.session.getSnapshot().transcript, '', 'late final results must not reappear on the next line');
    // "¡No!" has finished; its native recognition service is still finishing.
    f.session.notifyPlaybackEnd();
    f.session.configure(options({ lineKey: `actor-${turn + 1}` }));
    assert.equal(f.handles.length, turn + 1, 'wait for native end before starting another recognition');
    current.end();
    t.mock.timers.tick(250);
    assert.equal(f.cues.length, 0, 'the app voice already prepared recognition; do not add Te escucho');
    assert.equal(f.handles.length, turn + 2);
    assert.equal(current.aborted, undefined);
  }
  f.handles.at(-1).receive('Sigo ensayando');
  assert.equal(f.session.getSnapshot().transcript, 'Sigo ensayando');
  assert.equal(f.poisoned(), false);
});

test('audioend can release playback while native service shutdown still waits independently', async (t) => {
  const f = fixture(t);
  f.session.configure(options()); f.session.stop();
  let fullEnd = false;
  const pending = f.session.waitForEnd().then((ended) => { fullEnd = ended; });
  f.handles[0].audioEnd();
  assert.equal(await f.session.waitForInputEnd(), true);
  assert.equal(f.session.getInputEndReason(), 'fin de captura');
  assert.equal(fullEnd, false);
  f.handles[0].end(); await pending;
  assert.equal(fullEnd, true);
});

test('a continuous recognizer never uses final plus speechend as proof that its input ended', async (t) => {
  const f = fixture(t, { naturalEnd: false });
  f.session.configure(options());
  f.handles[0].receive('Una frase'); f.handles[0].onspeechend?.();
  let ready = false;
  const pending = f.session.waitForInputEnd().then((ended) => { ready = ended; });
  await Promise.resolve();
  assert.equal(ready, false);
  f.handles[0].audioEnd(); await pending;
  assert.equal(ready, true);
});

test('missing native input-finished signals keep a deadline and never force an abort', async (t) => {
  const f = fixture(t);
  f.session.configure(options()); f.handles[0].receive('Palabras', false); f.session.stop();
  const input = f.session.waitForInputEnd();
  t.mock.timers.tick(12000);
  assert.equal(await input, false);
  assert.equal(f.handles[0].aborted, undefined);
  assert.equal(f.poisoned(), false);
});

test('a browser that omits speechend and audioend still releases playback at ordinary native end', async (t) => {
  const f = fixture(t);
  f.session.configure(options()); f.session.stop();
  const input = f.session.waitForInputEnd();
  f.handles[0].end();
  assert.equal(await input, true);
  assert.equal(f.session.getInputEndReason(), 'fin de servicio');
  assert.equal(f.handles[0].aborted, undefined);
});
