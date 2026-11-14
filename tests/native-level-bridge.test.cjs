const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const { setImmediate: settle } = require('node:timers/promises');
const previous = require.extensions['.ts'];
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { createNativePrototypeController } = require('../src/nativePrototype/controller.ts');
const { nativeBridgeBootstrap } = require('../src/nativePrototype/bridgeBootstrap.ts');
const { parseBridgeCommand } = require('../src/nativePrototype/protocol.ts');
if (previous) require.extensions['.ts'] = previous; else delete require.extensions['.ts'];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { await settle(); await settle(); };
const fixture = (t, options = {}) => {
  const levels = [], speech = [], starts = [], closed = deferred();
  let meter = false, recognition = false, stops = 0, window;
  const controller = createNativePrototypeController({
    emit: event => window?.__AI_THEATRE_NATIVE_RECEIVE__(event),
    requestPermission: () => options.permission || Promise.resolve(true), isRecognitionAvailable: () => options.recognitionAvailable !== false,
    startRecognition: settings => { assert.equal(meter, false); recognition = true; starts.push(settings); },
    abortRecognition: () => { recognition = false; controller.recognitionEvent('end'); },
    stopRecognition: () => { recognition = false; controller.recognitionEvent('end'); },
    voices: async () => [], stopSpeech: async () => {},
    speak: (text, settings) => { assert.equal(meter, false); assert.equal(recognition, false); speech.push(text); settings.onStart(); settings.onDone(); },
    startLevelInput: async onLevel => { assert.equal(meter, false); assert.equal(recognition, false); meter = true; levels.push(onLevel); onLevel(0); },
    stopLevelInput: async () => { stops++; if (options.stopFailure) throw Error('native close failed'); await closed.promise; meter = false; },
  });
  const replaceDocument = () => {
    window = Object.assign(new EventTarget(), { ReactNativeWebView: { postMessage: text => controller.handle(parseBridgeCommand(text)) } });
    vm.runInNewContext(nativeBridgeBootstrap({ platform: 'android', appVersion: '2026.11.231', nativeLevelInput: true }), { window, Event, Map, JSON });
    return window;
  };
  replaceDocument(); t.after(() => { closed.resolve(); controller.dispose(); });
  return { get window() { return window; }, controller, closed, speech, starts, levels, replaceDocument, stops: () => stops };
};

test('native calibration must acknowledge the physical close before speech can start', async t => {
  const f = fixture(t); const meter = f.window.__AI_THEATRE_NATIVE_LEVEL_INPUT__.open(() => {}, () => {}); await meter.ready;
  const closing = meter.stop(); f.window.speechSynthesis.speak(new f.window.SpeechSynthesisUtterance('Después del pitido.'));
  await flush(); assert.equal(f.stops(), 1); assert.deepEqual(f.speech, []);
  f.closed.resolve(); await closing; await flush(); assert.deepEqual(f.speech, ['Después del pitido.']);
});

test('native microphone calibration does not require a speech recognizer or language model', async t => {
  const f = fixture(t, { recognitionAvailable: false });
  const meter = f.window.__AI_THEATRE_NATIVE_LEVEL_INPUT__.open(() => {}, () => {}); await meter.ready;
  assert.equal(f.levels.length, 1); assert.equal(f.starts.length, 0);
  f.closed.resolve(); await meter.stop();
});

test('native recognition cannot overlap a calibration input which is still closing', async t => {
  const f = fixture(t); const meter = f.window.__AI_THEATRE_NATIVE_LEVEL_INPUT__.open(() => {}, () => {}); await meter.ready;
  const closing = meter.stop(); const recognition = new f.window.SpeechRecognition(); recognition.start();
  await flush(); assert.equal(f.starts.length, 0); assert.equal(f.stops(), 1);
  f.closed.resolve(); await closing; await flush(); assert.equal(f.starts.length, 1);
});

test('cancelling calibration while permission is pending cannot open a recorder after the grant', async t => {
  const permission = deferred(), f = fixture(t, { permission: permission.promise });
  const meter = f.window.__AI_THEATRE_NATIVE_LEVEL_INPUT__.open(() => {}, () => {});
  const rejected = assert.rejects(meter.ready, /cancelled/); await flush(); await meter.stop(); await rejected;
  permission.resolve(true); await flush(); assert.equal(f.levels.length, 0); assert.equal(f.stops(), 0);
});

test('a reloaded document ignores old meter levels, terminal callbacks and recognition events', async t => {
  const f = fixture(t), oldLevels = [], newLevels = [];
  const old = f.window.__AI_THEATRE_NATIVE_LEVEL_INPUT__.open(value => oldLevels.push(value), () => {}); await old.ready;
  f.controller.resetDocument(); f.replaceDocument();
  const current = f.window.__AI_THEATRE_NATIVE_LEVEL_INPUT__.open(value => newLevels.push(value), () => {});
  await flush(); assert.equal(f.levels.length, 1);
  f.levels[0](0.9); assert.deepEqual(newLevels, []);
  f.closed.resolve(); await current.ready; f.levels[0](0.8); f.levels[1](0.2);
  assert.deepEqual(newLevels, [0, 0.2]);
  let ended = false; current.closed.then(() => { ended = true; });
  f.window.__AI_THEATRE_NATIVE_RECEIVE__({ type: 'microphone.end', id: old.id });
  f.controller.recognitionEvent('end'); await flush(); assert.equal(ended, false);
  await current.stop(); assert.equal(ended, true);
});

test('a native stop failure cannot manufacture a closed microphone or allow queued speech', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, { stopFailure: true });
  const meter = f.window.__AI_THEATRE_NATIVE_LEVEL_INPUT__.open(() => {}, () => {}); await meter.ready;
  let closed = false; meter.stop().then(() => { closed = true; });
  const speech = new f.window.SpeechSynthesisUtterance('No debe solaparse'); let failure;
  speech.onerror = event => { failure = event.message; }; f.window.speechSynthesis.speak(speech);
  await flush(); t.mock.timers.tick(8001); await flush();
  assert.equal(closed, false); assert.equal(f.speech.length, 0); assert.match(failure, /no ha confirmado/);
});
