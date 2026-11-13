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
const { playCalibrationVoice: voice, playCalibrationBeep: beep,
  primeRehearsalAudioPlayer: prime } = require('../src/utils/rehearsalCalibrationAudio.ts');
const { speakRehearsalSpeech: speak, stopRehearsalSpeech: stop, prepareRecognitionRestart } = require('../src/utils/rehearsalSpeech.ts');
const { getSpeechOutputPlatform, getSpeechOutputHelp, getSpeechOutputErrorMessage } = require('../src/utils/speechOutputHelp.ts');
Module._load = previousLoad;
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

const player = (overrides = {}) => ({
  src: '', currentTime: 0, muted: true, onended: null, onerror: null,
  pause() {}, load() {}, removeAttribute() { this.src = ''; },
  play: async () => {}, ...overrides,
});

test('Safari media playback is unmuted and starts inside the tap without awaiting audio-context resume', async () => {
  let inTap = true;
  let resume;
  const events = [];
  const audio = player({ play() {
    assert.equal(inTap, true);
    assert.equal(this.muted, false);
    events.push('play');
    return Promise.resolve();
  } });
  const pending = prime(audio, 'blob:silence', () => {
    events.push('resume');
    return new Promise((resolve) => { resume = resolve; });
  });
  inTap = false;
  assert.deepEqual(events, ['resume', 'play']);
  resume();
  assert.equal(await pending, true);
  assert.equal(audio.src, '');
});

test('media authorization failures remain failures rather than claiming audio was unlocked', async () => {
  assert.equal(await prime(player({ play: async () => { throw new Error('NotAllowedError'); } }),
    'blob:silence', async () => {}), false);
});

test('an audio-context resume that never settles cannot leave calibration waiting forever', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = prime(player(), 'blob:silence', () => new Promise(() => {}), 500);
  t.mock.timers.tick(500);
  assert.equal(await pending, false);
});

test('a pending primer cannot pause or unload a newer beep or song', async () => {
  let playing;
  let paused = 0;
  const audio = player({ pause() { paused += 1; }, play: () => new Promise((resolve) => { playing = resolve; }) });
  const pending = prime(audio, 'blob:silence', async () => {});
  audio.src = 'blob:beep';
  playing();
  assert.equal(await pending, false);
  assert.equal(audio.src, 'blob:beep');
  assert.equal(paused, 1);
});

test('the first calibration voice starts in the tap and must actually finish before measuring noise', async () => {
  let inTap = true;
  let callbacks;
  const pending = voice('Guarda silencio.', {
    speak(text, handlers) { assert.equal(inTap, true); assert.equal(text, 'Guarda silencio.'); callbacks = handlers; },
    stop() {},
  });
  inTap = false;
  callbacks.onDone();
  await pending;
});

test('a rejected or silent speech synthesis does not advance to the beep', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let stopped = 0;
  await assert.rejects(voice('Prueba.', {
    speak: (_, callbacks) => callbacks.onError(new Error('not-allowed')), stop: () => { stopped += 1; },
  }), /calibration-voice-unavailable/);
  const timedOut = voice('Prueba.', { speak() {}, stop: () => { stopped += 1; } }, 500);
  const rejection = assert.rejects(timedOut, /calibration-voice-unavailable/);
  t.mock.timers.tick(500);
  await rejection;
  assert.equal(stopped, 2);
});

test('the beep resumes its output, clears mute, and waits for ended before starting voice measurement', async () => {
  let resumed = false;
  let played = false;
  const audio = player({ play: async () => { played = true; } });
  const pending = beep(audio, 'blob:tone', async () => { resumed = true; });
  assert.equal(resumed, true);
  assert.equal(played, true);
  assert.equal(audio.muted, false);
  audio.onended();
  await pending;
  assert.equal(audio.onended, null);
  assert.equal(audio.onerror, null);
});

test('a blocked, failed or silent beep fails calibration instead of resolving after a fixed delay', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await assert.rejects(beep(player({ play: async () => { throw new Error('NotAllowedError'); } }),
    'blob:tone', async () => {}), /calibration-beep-unavailable/);
  const audio = player();
  const failed = beep(audio, 'blob:tone', async () => {});
  const failedAssertion = assert.rejects(failed, /calibration-beep-unavailable/);
  audio.onerror();
  await failedAssertion;
  const silent = beep(player(), 'blob:tone', async () => {}, 500);
  const silentAssertion = assert.rejects(silent, /calibration-beep-unavailable/);
  t.mock.timers.tick(500);
  await silentAssertion;
});

test('an obsolete beep timeout cannot stop or detach the next song', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let paused = 0;
  const audio = player({ pause() { paused += 1; } });
  const pending = beep(audio, 'blob:tone', async () => {}, 500);
  const rejection = assert.rejects(pending, /calibration-beep-unavailable/);
  audio.src = 'blob:new-song';
  const nextEnded = () => {};
  audio.onended = nextEnded;
  t.mock.timers.tick(500);
  await rejection;
  assert.equal(audio.onended, nextEnded);
  assert.equal(paused, 1);
});

const speechBrowser = (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const utterances = [];
  class Utterance { constructor(text) { this.text = text; } }
  const previousWindow = global.window;
  const synth = {
    cancel() {}, resume() {}, getVoices: () => [],
    speak: (utterance) => utterances.push(utterance),
  };
  global.window = { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance };
  t.after(() => { stop(); global.window = previousWindow; });
  return { synth, utterances };
};

test('speaker guidance uses the actual phone or native shell and retains the verified iPhone silent-mode advice', () => {
  assert.equal(getSpeechOutputPlatform({ userAgent: 'Android 16' }), 'android');
  assert.equal(getSpeechOutputPlatform({ userAgent: 'iPhone' }), 'ios');
  assert.equal(getSpeechOutputPlatform({ platform: 'MacIntel', maxTouchPoints: 5 }), 'ios');
  assert.equal(getSpeechOutputPlatform({ platform: 'Win32' }), 'other');
  assert.equal(getSpeechOutputPlatform({ platform: 'Win32' }, 'android'), 'android');
  assert.match(getSpeechOutputHelp('ios'), /Silencio/);
  assert.doesNotMatch(getSpeechOutputHelp('android'), /iPhone|campana/);
  assert.match(getSpeechOutputHelp('android'), /texto a voz/);
});

test('the speaker failure retains its underlying cause and gives Android service guidance instead of a volume-only retry', () => {
  const timeout = new Error('calibration-voice-unavailable', { cause: new Error('speech-start-timeout') });
  assert.match(getSpeechOutputErrorMessage(timeout, 'android'), /no ha respondido/);
  assert.match(getSpeechOutputErrorMessage(timeout, 'android'), /BlueStacks/);
  assert.match(getSpeechOutputErrorMessage(timeout, 'android'), /speech-start-timeout/);
  assert.doesNotMatch(getSpeechOutputErrorMessage(timeout, 'android'), /calibration-voice-unavailable/);
  const missingVoice = new Error('calibration-voice-unavailable', { cause: new Error('voice-unavailable') });
  assert.match(getSpeechOutputErrorMessage(missingVoice, 'other'), /voice-unavailable/);
});

test('Android retries a rejected explicit voice with the system Spanish voice and preserves the final service error', t => {
  const { synth, utterances } = speechBrowser(t);
  global.window.__AI_THEATRE_NATIVE_V1__ = { protocol: 1, platform: 'android', appVersion: '2026.11.225', foreground: true };
  synth.getVoices = () => [{ id: 'bad-voice', lang: 'es-ES', name: 'Spanish' }];
  let failure;
  speak('La misma frase.', { rate: 1.1, onError: error => { failure = error; } });
  assert.equal(utterances[0].voice.id, 'bad-voice');
  utterances[0].onerror({ error: 'voice-unavailable' });
  t.mock.timers.tick(250);
  assert.equal(utterances.length, 2);
  assert.equal(utterances[1].voice, undefined);
  assert.equal(utterances[1].lang, 'es-ES');
  assert.equal(utterances[1].rate, 1.1);
  assert.equal(utterances[1].text, 'La misma frase.');
  utterances[1].onerror({ error: 'synthesis-unavailable', message: 'Android no tiene un motor de voz disponible.' });
  assert.equal(failure.message, 'Android no tiene un motor de voz disponible.');
});

test('a speaker check that starts but never ends is stopped, and its late callbacks cannot finish the next voice', async (t) => {
  const { synth, utterances } = speechBrowser(t);
  let stopped = 0;
  synth.cancel = () => { stopped += 1; };
  const pending = voice('Hola, hola, dime si me oyes.', {
    speak: (text, callbacks) => speak(text, { ...callbacks, resetBeforeStart: true }), stop,
  });
  utterances[0].onstart();
  const staleDone = utterances[0].onend;
  const rejection = assert.rejects(pending, /calibration-voice-unavailable/);
  t.mock.timers.tick(7000);
  await rejection;
  assert.equal(stopped, 2, 'one initial reset and one timeout cleanup');
  let nextCompleted = 0;
  speak('Nuevo intento.', { onDone: () => { nextCompleted += 1; } });
  utterances[1].onstart();
  staleDone();
  assert.equal(nextCompleted, 0);
  utterances[1].onend();
  assert.equal(nextCompleted, 1);
  t.mock.timers.tick(10000);
  assert.equal(stopped, 2);
});

test('cancelling calibration cannot retry its voice or complete an obsolete announcement', (t) => {
  const { utterances } = speechBrowser(t);
  let completed = 0;
  speak('Calibración anterior.', { onDone: () => { completed += 1; } });
  const staleError = utterances[0].onerror;
  const staleDone = utterances[0].onend;
  stop();
  speak('Ensayo nuevo.', {});
  utterances[1].onstart();
  staleError(); staleDone();
  t.mock.timers.tick(10000);
  assert.deepEqual(utterances.map((utterance) => utterance.text), ['Calibración anterior.', 'Ensayo nuevo.']);
  assert.equal(completed, 0);
});

test('a speech startup timeout retries once and then reports one actionable error', (t) => {
  const { synth, utterances } = speechBrowser(t);
  // Some browsers dispatch an error synchronously in cancel().
  synth.cancel = () => utterances.at(-1)?.onerror?.();
  const errors = [];
  speak('Prueba.', { onError: (error) => errors.push(error.message) });
  t.mock.timers.tick(1800);
  t.mock.timers.tick(250);
  assert.equal(utterances.length, 2);
  t.mock.timers.tick(1800);
  t.mock.timers.tick(10000);
  assert.deepEqual(errors, ['speech-start-timeout']);
});

test('cancelling an old recognition cue cannot interrupt the next actor speech', (t) => {
  const { utterances } = speechBrowser(t);
  let ready = 0;
  const cancel = prepareRecognitionRestart({ onDone: () => { ready += 1; }, onError() {} });
  const oldDone = utterances[0].onend;
  speak('La frase del compañero.', {});
  cancel();
  oldDone();
  assert.equal(ready, 0);
  assert.equal(typeof utterances[1].onstart, 'function');
  utterances[1].onstart();
});
