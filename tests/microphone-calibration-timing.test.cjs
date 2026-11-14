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

const fixture = (t, options = {}) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 100;
  let sample = 128;
  let frameId = 0;
  const frames = new Map();
  const streams = [];
  const contexts = [];
  const nativeCaptures = [];
  const originals = new Map();
  const setGlobal = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(global, name));
    Object.defineProperty(global, name, { configurable: true, value });
  };
  class Context {
    constructor() { this.state = options.suspended ? 'suspended' : 'running'; contexts.push(this); }
    async resume() { if (options.resume) await options.resume(); this.state = 'running'; }
    close() { this.state = 'closed'; return options.close ? options.close() : Promise.resolve(); }
    createMediaStreamSource() {
      if (options.graphError) throw options.graphError;
      return { connect() {}, disconnect() {} };
    }
    createAnalyser() {
      return { fftSize: 2048, disconnect() {}, getByteTimeDomainData: (samples) => samples.fill(sample) };
    }
  }
  setGlobal('window', { AudioContext: Context, ...(options.nativeInput ? {
    __AI_THEATRE_NATIVE_V1__: { protocol: 1, platform: 'android', appVersion: '2026.11.231', nativeLevelInput: true },
    __AI_THEATRE_NATIVE_LEVEL_INPUT__: { open: (onLevel, onError) => {
      const capture = { active: true, onLevel, onError, ready: Promise.resolve(),
        stop: async () => { capture.active = false; } };
      nativeCaptures.push(capture); return capture;
    } },
  } : {}) });
  setGlobal('navigator', { userAgent: options.userAgent || '', mediaDevices: { getUserMedia: async (constraints) => {
    if (options.beforeCapture) await options.beforeCapture(constraints);
    const track = { enabled: true, readyState: 'live', stop() { this.readyState = 'ended'; } };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    streams.push(stream);
    return stream;
  } } });
  setGlobal('performance', { now: () => now });
  setGlobal('requestAnimationFrame', (callback) => { frames.set(++frameId, callback); return frameId; });
  setGlobal('cancelAnimationFrame', (id) => frames.delete(id));
  const hook = useSilenceAdvance({ preferNativeInput: !!options.nativeInput, enabledForCurrentLine: false, lineKey: null, onSilenceDetected() {} });
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
      if (!options.freezeNativeLevels) nativeCaptures.filter(capture => capture.active).forEach(capture => capture.onLevel(Math.abs(sample - 128) / 128));
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
  return { hook, advance, measureNoise, streams, contexts, nativeCaptures };
};

test('native Android preparation measures noise and voice without opening a WebView microphone or AudioContext', async t => {
  const f = fixture(t, { nativeInput: true });
  assert.equal((await f.measureNoise()).measurement, 'native_peak');
  await f.hook.releaseListeningInput(); assert.equal(f.nativeCaptures[0].active, false);
  await f.hook.startListening(); const voice = f.hook.calibrateVoiceLevel(2200); f.advance(2500, 135);
  const result = await voice; assert.ok(['ready', 'weak'].includes(result.status)); assert.equal(result.measurement, 'native_peak');
  assert.equal(f.streams.length, 0); assert.equal(f.contexts.length, 0); assert.equal(f.nativeCaptures.length, 2);
});

test('late native levels from a retired calibration cannot supply voice to a new silent attempt', async t => {
  const f = fixture(t, { nativeInput: true }); await f.measureNoise();
  await f.hook.releaseListeningInput(); await f.hook.startListening();
  f.nativeCaptures[0].onLevel(0.8);
  const voice = f.hook.calibrateVoiceLevel(2200); f.advance(10100, 129);
  assert.equal((await voice).status, 'error');
});

test('a native meter which stalls cannot pass calibration from cached levels', async t => {
  const options = { nativeInput: true }, f = fixture(t, options);
  await f.hook.startListening(); const noise = f.hook.calibrateAmbientNoise(1800);
  f.advance(200, 129); options.freezeNativeLevels = true; f.advance(1800, 129);
  assert.equal((await noise).status, 'error');
  assert.equal(f.hook.getMicrophoneInputDiagnostic().stage, 'processor');
  assert.match(f.hook.getMicrophoneInputFailure().message, /niveles recientes/);
});

test('a denied capture retains its actual error for calibration and a permitted retry clears it', async (t) => {
  const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
  let rejectCapture = true;
  const f = fixture(t, { beforeCapture: async () => { if (rejectCapture) throw denied; } });
  await f.hook.startListening();
  assert.equal(f.hook.getMicrophoneInputFailure(), denied);
  assert.equal(f.streams.length, 0);
  rejectCapture = false;
  await f.hook.startListening();
  assert.equal(f.hook.getMicrophoneInputFailure(), null);
  assert.equal(f.streams[0].getTracks()[0].readyState, 'live');
  assert.equal((await f.measureNoise()).status, 'ready');
});

test('Android recovers a rejected processed input and keeps the same raw profile for noise and voice', async (t) => {
  const requests = [];
  const f = fixture(t, { userAgent: 'Android Chrome/135.0.0.0', beforeCapture: constraints => {
    requests.push(constraints);
    if (constraints.audio.echoCancellation) throw Object.assign(new Error('Could not start audio source'), { name: 'NotReadableError' });
  } });
  assert.equal((await f.measureNoise()).status, 'ready');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].audio.echoCancellation, false);
  assert.equal(requests[1].audio.noiseSuppression, false);
  assert.equal(requests[1].audio.autoGainControl, false);
  await f.hook.releaseListeningInput();
  await f.hook.startListening();
  assert.equal(requests.length, 3);
  assert.equal(requests[2].audio.echoCancellation, false);
  const voice = f.hook.calibrateVoiceLevel(2200); f.advance(2500, 135);
  assert.ok(['ready', 'weak'].includes((await voice).status));
});

test('Android retains both actual capture failures for diagnosis and opens no audio graph', async (t) => {
  let calls = 0;
  const f = fixture(t, { userAgent: 'Android Chrome/135.0.0.0', beforeCapture: () => {
    throw Object.assign(new Error(++calls === 1 ? 'processed failed' : 'raw failed'), { name: 'NotReadableError' });
  } });
  await f.hook.startListening();
  assert.equal(calls, 2);
  assert.equal(f.contexts.length, 0);
  assert.equal(f.hook.getMicrophoneInputFailure().message, 'raw failed');
  const diagnostic = f.hook.getMicrophoneInputDiagnostic();
  assert.equal(diagnostic.stage, 'capture'); assert.equal(diagnostic.status, 'error');
  assert.deepEqual(diagnostic.attempts.map(attempt => [attempt.profile, attempt.errorMessage]),
    [['processed', 'processed failed'], ['unprocessed', 'raw failed']]);
});

test('Android permission denial never retries with a different input profile', async (t) => {
  let calls = 0;
  const f = fixture(t, { userAgent: 'Android Chrome/135.0.0.0', beforeCapture: () => {
    calls++; throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
  } });
  await f.hook.startListening();
  assert.equal(calls, 1);
  assert.equal(f.hook.getMicrophoneInputFailure().name, 'NotAllowedError');
});

test('Safari input failures keep their single capture attempt', async (t) => {
  let calls = 0;
  const f = fixture(t, { userAgent: 'iPhone Safari/604.1', beforeCapture: () => {
    calls++; throw Object.assign(new Error('source failed'), { name: 'NotReadableError' });
  } });
  await f.hook.startListening(); assert.equal(calls, 1);
});

test('a cancelled Android failure cannot trigger a fallback capture', async (t) => {
  let reject, calls = 0;
  const f = fixture(t, { userAgent: 'Android Chrome/135.0.0.0', beforeCapture: () => {
    calls++; return new Promise((resolve, fail) => { reject = fail; });
  } });
  const pending = f.hook.startListening(); await f.hook.releaseListeningInput();
  reject(Object.assign(new Error('stale'), { name: 'NotReadableError' })); await pending;
  assert.equal(calls, 1); assert.equal(f.contexts.length, 0);
});

test('an audio processor failure releases the acquired microphone before the next calibration attempt', async (t) => {
  const denied = new Error('AudioContext could not resume');
  let fail = true;
  const f = fixture(t, { suspended: true, resume: async () => { if (fail) throw denied; } });
  await f.hook.startListening();
  assert.equal(f.hook.getMicrophoneInputFailure(), denied);
  assert.equal(f.streams[0].getTracks()[0].readyState, 'ended');
  assert.equal(f.contexts[0].state, 'closed');
  fail = false;
  await f.hook.startListening();
  assert.equal(f.streams.length, 2);
  assert.equal(f.streams[1].getTracks()[0].readyState, 'live');
  assert.equal(f.hook.getMicrophoneInputFailure(), null);
});

test('a failed audio graph releases its stream and preserves the device error', async (t) => {
  const failure = Object.assign(new Error('Audio input is unavailable'), { name: 'NotReadableError' });
  const f = fixture(t, { graphError: failure });
  await f.hook.startListening();
  assert.equal(f.hook.getMicrophoneInputFailure(), failure);
  assert.equal(f.streams[0].getTracks()[0].readyState, 'ended');
  assert.equal(f.contexts[0].state, 'closed');
});

test('a capture granted after cancellation is released before creating another audio processor', async (t) => {
  let allow;
  const f = fixture(t, { beforeCapture: () => new Promise(resolve => { allow = resolve; }) });
  const pending = f.hook.startListening();
  await f.hook.releaseListeningInput();
  allow();
  await pending;
  assert.equal(f.streams[0].getTracks()[0].readyState, 'ended');
  assert.equal(f.contexts.length, 0);
  assert.equal(f.hook.getMicrophoneInputFailure(), null);
});

test('an old input release waiting for close cannot stop a new calibration stream', async (t) => {
  let finishClose;
  const options = { close: () => new Promise(resolve => { finishClose = resolve; }) };
  const f = fixture(t, options);
  await f.hook.startListening();
  const release = f.hook.releaseListeningInput();
  await f.hook.startListening();
  options.close = undefined;
  finishClose();
  await release;
  assert.equal(f.streams[0].getTracks()[0].readyState, 'ended');
  assert.equal(f.streams[1].getTracks()[0].readyState, 'live');
  const noise = f.hook.calibrateAmbientNoise(1800);
  f.advance(1900, 129);
  assert.equal((await noise).status, 'ready');
});

test('the physical capture is already ended when the audio backend starts closing', async (t) => {
  const f = fixture(t, { close: () => {
    assert.equal(f.streams[0].getTracks()[0].readyState, 'ended');
    return Promise.resolve();
  } });
  await f.hook.startListening(); await f.hook.releaseListeningInput();
  assert.equal(f.contexts[0].state, 'closed');
});

test('a cancelled permission request rejected later cannot replace a working retry with an error', async (t) => {
  let rejectOld;
  let calls = 0;
  const f = fixture(t, { beforeCapture: () => ++calls === 1
    ? new Promise((resolve, reject) => { rejectOld = reject; }) : Promise.resolve() });
  const old = f.hook.startListening();
  await f.hook.releaseListeningInput();
  await f.hook.startListening();
  rejectOld(Object.assign(new Error('Old permission denied'), { name: 'NotAllowedError' }));
  await old;
  assert.equal(f.hook.getMicrophoneInputFailure(), null);
  assert.equal(f.streams[0].getTracks()[0].readyState, 'live');
  const noise = f.hook.calibrateAmbientNoise(1800);
  f.advance(1900, 129);
  assert.equal((await noise).status, 'ready');
});

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

test('silence-mode dialogue cycles release capture before playback and acquire fresh input afterwards', async (t) => {
  const f = fixture(t);
  for (let turn = 0; turn < 6; turn += 1) {
    await f.hook.startListening();
    const track = f.streams.at(-1).getTracks()[0];
    await f.hook.releaseListeningInput();
    assert.equal(track.readyState, 'ended');
    assert.equal(f.contexts.at(-1).state, 'closed');
    assert.equal(f.streams.length, turn + 1);
  }
});

test('a live track left muted by Safari is never reused for the next actor turn', async (t) => {
  const f = fixture(t);
  await f.hook.startListening();
  const previousTrack = f.streams[0].getTracks()[0];
  await f.hook.stopListening();
  previousTrack.muted = true;
  await f.hook.startListening();
  assert.equal(f.streams.length, 2);
  assert.equal(previousTrack.readyState, 'ended');
  assert.equal(f.streams[1].getTracks()[0].readyState, 'live');
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
