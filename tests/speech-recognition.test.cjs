const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createSpeechRecognitionSession } = require('../src/utils/speechRecognitionSession.ts');
const { getSpeechRecognitionPermissionHelp, IOS_SPEECH_RECOGNITION_SETTINGS_PATH } = require('../src/utils/speechRecognitionPermissionHelp.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

const result = (text, isFinal = true) => ({ isFinal, 0: { transcript: text } });
const options = (overrides = {}) => ({ enabled: true, lang: 'es-ES', lineKey: 'line-1', ...overrides });
const fixture = (t, onStart = () => {}) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const handles = [];
  class Recognition {
    constructor() { handles.push(this); }
    start() { onStart(this); }
    abort() { this.aborted = true; }
  }
  const session = createSpeechRecognitionSession(Recognition, () => {});
  t.after(() => session.dispose());
  return { session, handles };
};

test('does not claim the microphone is open just because recognition started', (t) => {
  const { session, handles } = fixture(t);
  session.configure(options());
  assert.equal(session.getSnapshot().status, 'starting');
  handles[0].onstart();
  assert.equal(session.getSnapshot().isAudioActive, false);
  handles[0].onaudiostart();
  assert.equal(session.getSnapshot().status, 'listening');
  assert.equal(session.getSnapshot().isAudioActive, true);
});

test('permission errors survive end events and subsequent scene changes without a retry loop', (t) => {
  const { session, handles } = fixture(t);
  session.configure(options());
  const staleEnd = handles[0].onend;
  handles[0].onerror({ error: 'not-allowed' });
  staleEnd();
  session.configure(options({ lineKey: 'line-2' }));
  t.mock.timers.tick(20000);
  assert.equal(handles.length, 1);
  assert.equal(session.getSnapshot().status, 'error');
  assert.equal(session.getSnapshot().errorCode, 'not-allowed');
  assert.match(session.getSnapshot().error, /no ha autorizado/);
});

test('explicit activation calls start synchronously in the tap handler and clears the block', (t) => {
  let inTap = false;
  let startedInTap = false;
  const { session, handles } = fixture(t, () => { startedInTap = inTap; });
  session.configure(options());
  handles[0].onerror({ error: 'service-not-allowed' });
  inTap = true;
  session.restart();
  inTap = false;
  assert.equal(handles.length, 2);
  assert.equal(startedInTap, true);
  assert.equal(session.getSnapshot().error, null);
  handles[1].onaudiostart();
  handles[1].onresult({ results: [result('Ey, Sonny')] });
  assert.equal(session.getSnapshot().transcript, 'Ey, Sonny');
});

test('offers recovery when the browser never opens audio or reports an error', (t) => {
  const { session, handles } = fixture(t);
  session.configure(options());
  handles[0].onstart();
  t.mock.timers.tick(15000);
  assert.equal(session.getSnapshot().status, 'error');
  assert.match(session.getSnapshot().error, /no ha abierto el micrófono/);
  assert.equal(handles[0].aborted, true);
  t.mock.timers.tick(20000);
  assert.equal(handles.length, 1);
});

test('an immediate silent end stops retries and keeps an actionable error', (t) => {
  const { session, handles } = fixture(t);
  session.configure(options());
  handles[0].onend();
  t.mock.timers.tick(20000);
  assert.equal(handles.length, 1);
  assert.match(session.getSnapshot().error, /sin abrir el micrófono/);
});

test('a normal end after capturing audio resumes and retains the current phrase', (t) => {
  const { session, handles } = fixture(t);
  session.configure(options());
  handles[0].onaudiostart();
  handles[0].onresult({ results: [result('Voy a')] });
  handles[0].onend();
  t.mock.timers.tick(250);
  assert.equal(handles.length, 2);
  handles[1].onresult({ results: [result('buscarla', false)] });
  assert.equal(session.getSnapshot().transcript, 'Voy a buscarla');
  assert.equal(session.getSnapshot().interimTranscript, 'buscarla');
});

test('ordinary silence can resume without being treated as denied permission', (t) => {
  const { session, handles } = fixture(t);
  session.configure(options());
  handles[0].onaudiostart();
  handles[0].onerror({ error: 'no-speech' });
  handles[0].onend();
  t.mock.timers.tick(250);
  assert.equal(handles.length, 2);
  assert.equal(session.getSnapshot().error, null);
});

test('network and audio-capture failures wait for the actor to retry', (t) => {
  const { session, handles } = fixture(t);
  session.configure(options());
  handles[0].onerror({ error: 'network' });
  t.mock.timers.tick(1000);
  assert.equal(handles.length, 1);
  assert.match(session.getSnapshot().error, /conexión/);
  session.restart();
  handles[1].onerror({ error: 'audio-capture' });
  assert.match(session.getSnapshot().error, /disponible/);
});

test('a constructor/start exception produces a recoverable error without background retries', (t) => {
  const { session, handles } = fixture(t, () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); });
  session.configure(options());
  t.mock.timers.tick(20000);
  assert.equal(handles.length, 1);
  assert.equal(session.getSnapshot().status, 'error');
  assert.match(session.getSnapshot().error, /no ha autorizado/);
});

test('disabling the mode or leaving cancels pending restarts and ignores stale callbacks', (t) => {
  const { session, handles } = fixture(t);
  session.configure(options());
  handles[0].onaudiostart();
  const staleResult = handles[0].onresult;
  handles[0].onend();
  session.configure(options({ enabled: false }));
  t.mock.timers.tick(20000);
  staleResult({ results: [result('ignored')] });
  session.restart();
  assert.equal(handles.length, 1);
  assert.equal(session.getSnapshot().transcript, '');
  assert.equal(session.getSnapshot().isAudioActive, false);
});

test('a language change restarts using the requested language', (t) => {
  const { session, handles } = fixture(t);
  session.configure(options());
  session.configure(options({ lang: 'en-US' }));
  assert.equal(handles.length, 2);
  assert.equal(handles[0].aborted, true);
  assert.equal(handles[1].lang, 'en-US');
});

test('changing cues clears final results but preserves the live microphone', (t) => {
  const { session, handles } = fixture(t);
  session.configure(options());
  handles[0].onaudiostart();
  handles[0].onresult({ results: [result('anterior')] });
  session.configure(options({ lineKey: 'line-2' }));
  handles[0].onresult({ results: [result('anterior'), result('ahora')] });
  assert.equal(handles.length, 1);
  assert.equal(session.getSnapshot().transcript, 'ahora');
});

test('a previous partial result cannot swallow the first words in a new cue', (t) => {
  const { session, handles } = fixture(t);
  session.configure(options());
  handles[0].onresult({ results: [result('voz del compañero', false)] });
  session.configure(options({ lineKey: 'line-2' }));
  assert.equal(handles.length, 2);
  handles[1].onresult({ results: [result('Ey, Sonny', false)] });
  assert.equal(session.getSnapshot().transcript, 'Ey, Sonny');
});

test('unsupported browsers remain unsupported without throwing', () => {
  const session = createSpeechRecognitionSession(null, () => {});
  session.configure(options());
  session.restart();
  assert.equal(session.getSnapshot().status, 'unsupported');
  session.dispose();
});

test('the recognition check activates the service within the tap before scene playback is enabled', (t) => {
  let inTap = false;
  let startedInTap = false;
  const { session, handles } = fixture(t, () => { startedInTap = inTap; });
  session.configure(options({ enabled: false }));
  assert.equal(handles.length, 0);
  inTap = true;
  session.activate({ lang: 'es-ES', lineKey: 'prepare:audition' });
  inTap = false;
  assert.equal(handles.length, 1);
  assert.equal(startedInTap, true);
  session.configure(options({ lineKey: 'prepare:audition' }));
  assert.equal(session.getSnapshot().isAudioActive, false);
  handles[0].onstart();
  assert.equal(session.getSnapshot().isAudioActive, false);
  handles[0].onaudiostart();
  assert.equal(session.getSnapshot().isAudioActive, true);
  session.configure(options());
  assert.equal(handles.length, 1);
  assert.notEqual(handles[0].aborted, true);
  handles[0].onresult({ results: [result('Ey, sonny')] });
  assert.equal(session.getSnapshot().transcript, 'Ey, sonny');
});

test('service availability, service authorization and microphone permission keep distinct causes', (t) => {
  const { session, handles } = fixture(t);
  session.activate({ lang: 'es-ES', lineKey: 'prepare' });
  handles[0].onerror({ error: 'service-not-allowed', message: 'Speech recognition service is not available' });
  assert.match(session.getSnapshot().error, /no está disponible/);
  assert.doesNotMatch(session.getSnapshot().error, /Permite|bloqueado/);
  assert.equal(session.getSnapshot().errorDetail, 'Speech recognition service is not available');
  session.activate({ lang: 'es-ES', lineKey: 'prepare' });
  handles[1].onerror({ error: 'service-not-allowed', message: 'Speech recognition service permission check has failed' });
  assert.match(session.getSnapshot().error, /acceder al servicio/);
  assert.doesNotMatch(session.getSnapshot().error, /Permite el micrófono/);
  session.activate({ lang: 'es-ES', lineKey: 'prepare' });
  handles[2].onerror({ error: 'not-allowed', message: 'Microphone permission check has failed' });
  assert.match(session.getSnapshot().error, /no tiene acceso al micrófono/);
  assert.equal(session.getSnapshot().errorCode, 'not-allowed');
});

test('recognition preparation retries in place and preserves the exact native error across renders', (t) => {
  const { session, handles } = fixture(t);
  session.activate({ lang: 'es-ES', lineKey: 'prepare' });
  const message = 'Page is not visible to user';
  handles[0].onerror({ error: 'not-allowed', message });
  session.configure(options({ lineKey: 'prepare' }));
  session.resetTranscript();
  assert.equal(session.getSnapshot().errorDetail, message);
  assert.match(session.getSnapshot().error, /página no estaba visible/);
  session.activate({ lang: 'es-ES', lineKey: 'prepare' });
  assert.equal(handles.length, 2);
  assert.equal(session.getSnapshot().errorCode, null);
  assert.equal(session.getSnapshot().errorDetail, null);
  handles[1].onaudiostart();
  assert.equal(session.getSnapshot().isAudioActive, true);
});

const servicePermissionError = 'Speech recognition service permission check has failed';
const iphoneSafari = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' };

test('the observed iPhone service permission error shows the exact settings path and correct Safari entry', () => {
  const help = getSpeechRecognitionPermissionHelp('service-not-allowed', servicePermissionError, iphoneSafari);
  assert.equal(help.browserName, 'Safari');
  assert.equal(help.settingsPath, 'Ajustes → Privacidad y seguridad → Reconocimiento de voz');
  assert.ok(help.steps.some((step) => step.includes('icono azul de la brújula')));
  assert.equal(help.settingsPath, IOS_SPEECH_RECOGNITION_SETTINGS_PATH);
});

test('iOS settings guidance never misclassifies service unavailability or an unrelated microphone error', () => {
  for (const [code, detail] of [
    ['service-not-allowed', 'Speech recognition service is not available'],
    ['service-not-allowed', null],
    ['not-allowed', 'Microphone permission check has failed'],
    ['not-allowed', 'User permission check has failed'],
    ['network', servicePermissionError],
  ]) assert.equal(getSpeechRecognitionPermissionHelp(code, detail, iphoneSafari), null);
});

test('desktop iPad mode gets iOS help while a Mac or Android does not', () => {
  const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Version/18.0 Safari/605.1.15';
  assert.ok(getSpeechRecognitionPermissionHelp('service-not-allowed', servicePermissionError, {userAgent: ua, platform:'MacIntel', maxTouchPoints:5}));
  assert.equal(getSpeechRecognitionPermissionHelp('service-not-allowed', servicePermissionError, {userAgent: ua, platform:'MacIntel', maxTouchPoints:0}), null);
  assert.equal(getSpeechRecognitionPermissionHelp('service-not-allowed', servicePermissionError, {userAgent:'Mozilla/5.0 (Linux; Android 15) Chrome/130 Mobile Safari/537.36'}), null);
});

test('iOS browsers receive the name of their own app rather than being told to enable Safari', () => {
  for (const [marker, name] of [['CriOS/130','Chrome'], ['FxiOS/130','Firefox'], ['EdgiOS/130','Edge'], ['OPiOS/10','Opera']]) {
    const help = getSpeechRecognitionPermissionHelp('service-not-allowed', servicePermissionError, {userAgent: iphoneSafari.userAgent + ' ' + marker});
    assert.equal(help.browserName, name);
    assert.ok(help.steps.includes(`Activa ${name} en la lista.`));
  }
});

test('checking again actually reopens the service and removes permission help only after success', (t) => {
  let allowed = false;
  const { session, handles } = fixture(t, (handle) => setTimeout(() => {
    if (allowed) handle.onaudiostart();
    else handle.onerror({error:'service-not-allowed', message:servicePermissionError});
  }, 0));
  const help = () => getSpeechRecognitionPermissionHelp(session.getSnapshot().errorCode, session.getSnapshot().errorDetail, iphoneSafari);
  session.activate({lang:'es-ES',lineKey:'prepare:my-scene'});
  t.mock.timers.tick(0);
  assert.ok(help());
  session.activate({lang:'es-ES',lineKey:'prepare:my-scene'});
  t.mock.timers.tick(0);
  assert.ok(help());
  allowed = true;
  session.activate({lang:'es-ES',lineKey:'prepare:my-scene'});
  t.mock.timers.tick(0);
  assert.equal(handles.length, 3);
  assert.equal(session.getSnapshot().isAudioActive, true);
  assert.equal(help(), null);
});
