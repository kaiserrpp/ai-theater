const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
const previousLoad = Module._load;
Module._load = function (name, ...args) {
  // Exercise the real capture/RAF/calibration code without a React renderer.
  // The measured signal and pending results live in refs, independently of UI.
  if (name === 'react') return {
    useRef: (current) => ({ current }), useCallback: (callback) => callback,
    useEffect() {}, useMemo: (factory) => factory(),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  };
  return previousLoad.call(this, name, ...args);
};
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { useSilenceAdvance } = require('../src/hooks/useSilenceAdvance.ts');
Module._load = previousLoad;
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

const fixture = (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 100;
  let sample = 128;
  let frameId = 0;
  const frames = new Map();
  const streams = [];
  const contexts = [];
  const originals = new Map();
  const setGlobal = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(global, name));
    Object.defineProperty(global, name, { configurable: true, value });
  };
  class Context {
    constructor() { this.state = 'running'; contexts.push(this); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() {
      return { fftSize: 2048, disconnect() {}, getByteTimeDomainData: (samples) => samples.fill(sample) };
    }
  }
  setGlobal('window', { AudioContext: Context });
  setGlobal('navigator', { mediaDevices: { getUserMedia: async () => {
    const track = { enabled: true, readyState: 'live', stop() { this.readyState = 'ended'; } };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    streams.push(stream);
    return stream;
  } } });
  setGlobal('performance', { now: () => now });
  setGlobal('requestAnimationFrame', (callback) => { frames.set(++frameId, callback); return frameId; });
  setGlobal('cancelAnimationFrame', (id) => frames.delete(id));
  const hook = useSilenceAdvance({ enabledForCurrentLine: false, lineKey: null, onSilenceDetected() {} });
  t.after(async () => {
    await hook.releaseListening();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  });
  const advance = (durationMs, nextSample = sample) => {
    sample = nextSample;
    const until = now + durationMs;
    while (now < until) {
      now += 16;
      const callbacks = [...frames.values()]; frames.clear();
      callbacks.forEach((callback) => callback(now));
    }
  };
  const measureNoise = async () => {
    await hook.startListening();
    const pending = hook.calibrateAmbientNoise(1800);
    advance(1900, 129);
    return pending;
  };
  return { hook, advance, measureNoise, streams, contexts };
};

test('the actor can wait more than 2.2 seconds after the beep before starting a quiet phrase', async (t) => {
  const f = fixture(t);
  const noise = await f.measureNoise();
  assert.equal(noise.status, 'ready');
  await f.hook.releaseListeningInput();
  await f.hook.startListening();
  assert.equal(f.streams.length, 2);
  let settled = false;
  const pending = f.hook.calibrateVoiceLevel(2200).then((result) => { settled = true; return result; });
  f.advance(3500, 129); // Actor has not started; do not measure these as speech.
  await Promise.resolve();
  assert.equal(settled, false);
  f.advance(2600, 130); // About 1.6% RMS, matching a quiet input like the video.
  const result = await pending;
  assert.ok(['ready', 'weak'].includes(result.status));
  assert.ok(result.voiceLevel > result.noiseFloor);
  assert.ok(result.voiceLevel < 0.02);
});

test('background noise alone never completes the voice calibration as a usable phrase', async (t) => {
  const f = fixture(t);
  await f.measureNoise();
  const pending = f.hook.calibrateVoiceLevel(2200);
  f.advance(10100, 129);
  const result = await pending;
  assert.equal(result.status, 'error');
  assert.equal(result.voiceLevel, 0);
});

test('a browser which stops delivering microphone frames produces an error rather than an empty success', async (t) => {
  const f = fixture(t);
  await f.hook.startListening();
  const pending = f.hook.calibrateVoiceLevel(2200);
  t.mock.timers.tick(13000);
  const result = await pending;
  assert.equal(result.status, 'error');
  assert.equal(result.voiceLevel, 0);
});

test('cancelling a voice measurement resolves the old run and releases its physical input', async (t) => {
  const f = fixture(t);
  await f.hook.startListening();
  const pending = f.hook.calibrateVoiceLevel(2200);
  await f.hook.releaseListeningInput();
  assert.equal((await pending).status, 'error');
  assert.equal(f.streams[0].getTracks()[0].readyState, 'ended');
  assert.equal(f.contexts[0].state, 'closed');
});
