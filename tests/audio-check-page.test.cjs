const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createAudioChecks } = require('../public/prueba-audio.js');

const fixture = (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ids = [...fs.readFileSync(require.resolve('../public/prueba-audio.html'), 'utf8').matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  const node = () => ({
    textContent: '', value: '', hidden: true, style: {}, handlers: {}, attributes: {}, children: [],
    addEventListener(name, handler) { this.handlers[name] = handler; },
    setAttribute(name, value) { this.attributes[name] = value; },
    replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); },
  });
  const nodes = new Map(ids.map((id) => [id, node()]));
  const document = {
    getElementById: (id) => nodes.get(id) || null, createElement: node,
    handlers: {}, addEventListener(name, handler) { this.handlers[name] = handler; },
  };
  const spoken = [];
  const audios = [];
  const contexts = [];
  const tracks = [{ stopped: false, stop() { this.stopped = true; }, getSettings: () => ({ sampleRate: 48000, deviceId: 'private-device-id' }) }];
  const stream = { getTracks: () => tracks, getAudioTracks: () => tracks };
  const frames = new Map();
  let frameId = 0;
  let level = 128;
  let captured = 0;
  class Audio {
    constructor() { audios.push(this); }
    pause() {}
    load() {}
    play() { return Promise.resolve(); }
  }
  class AudioContext {
    constructor() { this.state = 'running'; this.currentTime = 0; contexts.push(this); }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 2048, getByteTimeDomainData: (samples) => samples.fill(level) }; }
    createGain() { return { gain: {}, connect() {} }; }
    createOscillator() { return this.oscillator = { frequency: {}, connect() {}, start() {}, stop() {} }; }
  }
  const runtime = {
    Audio, AudioContext, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: {
      getVoices: () => [{ name: 'Español', lang: 'es-ES', default: true, localService: true }],
      cancel() {}, resume() {}, speak: (utterance) => spoken.push(utterance), addEventListener() {},
    },
    navigator: { userAgent: 'iPhone test', mediaDevices: { getUserMedia: async () => { captured += 1; return stream; } } },
    isSecureContext: true, Blob,
    URL: { createObjectURL: () => 'blob:test-tone', revokeObjectURL() {} },
    setTimeout, clearTimeout,
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id) => frames.delete(id),
    handlers: {}, addEventListener(name, handler) { this.handlers[name] = handler; },
  };
  const checks = createAudioChecks(document, runtime);
  t.after(() => checks.destroy());
  const flush = async () => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); };
  return { checks, runtime, document, nodes, audios, contexts, spoken, tracks, stream, frames, flush,
    captured: () => captured, setLevel: (value) => { level = value; } };
};

test('voice is called directly in its tap without a microphone or media-play prerequisite', (t) => {
  const f = fixture(t);
  let inTap = true;
  f.runtime.speechSynthesis.speak = (utterance) => {
    assert.equal(inTap, true);
    assert.equal(f.captured(), 0);
    assert.match(utterance.text, /prueba de voz/);
  };
  f.nodes.get('test-voice').handlers.click();
  inTap = false;
  assert.equal(f.contexts.length, 0);
});

test('a finished browser speech event is never claimed as audible; the user confirms separately', (t) => {
  const f = fixture(t);
  f.checks.testVoice();
  f.spoken[0].onstart();
  f.spoken[0].onend();
  assert.equal(f.checks.getReport().tests.voice.state, 'finished');
  assert.equal(f.checks.getReport().tests.voice.heard, null);
  f.nodes.get('voice-no').handlers.click();
  assert.equal(f.checks.getReport().tests.voice.heard, false);
  assert.equal(f.nodes.get('voice-no').attributes['aria-pressed'], 'true');
});

test('silent speech has a visible timeout and cannot prevent the independent beep or microphone check', async (t) => {
  const f = fixture(t);
  f.checks.testVoice();
  t.mock.timers.tick(10000);
  assert.equal(f.checks.getReport().tests.voice.state, 'timeout');
  assert.match(f.nodes.get('status-voice').textContent, /no ha confirmado/);
  f.checks.testBeep();
  f.audios[0].onended();
  assert.equal(f.checks.getReport().tests.beep.state, 'finished');
  f.setLevel(140);
  f.checks.testMicrophone();
  await f.flush();
  assert.equal(f.captured(), 1);
  assert.equal(f.checks.getReport().tests.microphone.opened, true);
  t.mock.timers.tick(10000);
  assert.equal(f.checks.getReport().tests.microphone.signalReceived, true);
  assert.equal(f.tracks[0].stopped, true);
  assert.equal(f.checks.getReport().tests.microphone.settings.deviceId, undefined);
});

test('an opened but silent microphone stays distinguishable from an authorization failure', async (t) => {
  const f = fixture(t);
  f.checks.testMicrophone();
  await f.flush();
  t.mock.timers.tick(10000);
  assert.equal(f.checks.getReport().tests.microphone.signalReceived, false);
  assert.match(f.nodes.get('status-microphone').textContent, /no llegó señal/);
  f.runtime.navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }); };
  f.checks.testMicrophone();
  await f.flush();
  assert.equal(f.checks.getReport().tests.microphone.state, 'error');
  assert.equal(f.checks.getReport().tests.microphone.error.name, 'NotAllowedError');
});

test('permission granted after switching tests cannot leave the microphone open or overwrite a new result', async (t) => {
  const f = fixture(t);
  let allow;
  f.runtime.navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => { allow = resolve; });
  f.checks.testMicrophone();
  f.checks.testVoice();
  const currentSpeech = f.spoken.at(-1);
  allow(f.stream);
  await f.flush();
  assert.equal(f.tracks[0].stopped, true);
  assert.equal(f.checks.getReport().tests.microphone.state, 'cancelled');
  currentSpeech.onend();
  assert.equal(f.checks.getReport().tests.voice.state, 'finished');
});

test('beep play rejections are visible and stale speech callbacks cannot overwrite another test', async (t) => {
  const f = fixture(t);
  f.checks.testVoice();
  const staleEnd = f.spoken[0].onend;
  f.audios[0].play = async () => { throw Object.assign(new Error('Playback blocked'), { name: 'NotAllowedError' }); };
  f.checks.testBeep();
  staleEnd();
  await f.flush();
  assert.equal(f.checks.getReport().tests.voice.state, 'cancelled');
  assert.equal(f.checks.getReport().tests.beep.error.name, 'NotAllowedError');
});

test('hiding the page stops input tracks and closes its context', async (t) => {
  const f = fixture(t);
  f.checks.testMicrophone();
  await f.flush();
  f.document.hidden = true;
  f.document.handlers.visibilitychange();
  assert.equal(f.tracks[0].stopped, true);
  assert.equal(f.contexts[0].state, 'closed');
  assert.equal(f.frames.size, 0);
  assert.equal(f.checks.getReport().tests.microphone.state, 'cancelled');
});
