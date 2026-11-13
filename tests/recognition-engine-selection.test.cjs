const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

const load = (file, dependencies = {}, globals = {}) => {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    assert(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, ...globals });
  return exports;
};
const enginePreferences = load('utils/scriptRecognitionContext.ts');

test('an upgrade starts with Safari, while subsequent explicit Vosk, Whisper and comparison selections survive reopening', () => {
  const { REHEARSAL_RECOGNITION_ENGINE_STORAGE_KEY: key } = load('store/storageKeys.ts');
  const storage = new Map([['@teatro_ia_rehearsal_recognition_engine', 'comparison']]);
  assert.equal(enginePreferences.resolveRecognitionEngine(storage.get(key) ?? null), 'native');
  for (const selected of ['native', 'vosk', 'whisper', 'comparison']) {
    storage.set(key, selected);
    assert.equal(enginePreferences.resolveRecognitionEngine(storage.get(key)), selected);
  }
  assert.equal(enginePreferences.resolveRecognitionEngine('invalid'), 'native');
});

const hookFixture = ({ engine, nativeAvailable = true, voskAvailable = true, ios = true, controlledEnd = false } = {}) => {
  const calls = [];
  const effects = [];
  class Native {}
  Native.controlledInputEnd = controlledEnd;
  class Vosk {}
  class Whisper {}
  let configured;
  const hook = load('hooks/useSpeechRecognition.ts', {
    react: {
      useRef: current => ({ current }), useCallback: callback => callback, useMemo: factory => factory(),
      useState: initial => [initial, () => {}], useEffect: effect => effects.push(effect),
    },
    '../utils/scriptRecognitionContext': enginePreferences,
    '../utils/speechRecognitionCompatibility': { needsNaturalRecognitionEnd: () => ios },
    '../utils/rehearsalSpeech': { prepareRecognitionRestart: () => {} },
    '../utils/pageVisibility': { isPageVisible: () => true, observePageVisibility: () => () => {} },
    '../utils/localSpeechRecognition': {
      getLocalSpeechRecognitionConstructor: () => { calls.push('vosk:constructor'); return voskAvailable ? Vosk : null; },
      preloadLocalSpeechRecognition: async () => { calls.push('vosk:load'); },
      disposeLocalSpeechRecognition: () => calls.push('vosk:dispose'),
    },
    '../utils/whisperSpeechRecognition': {
      getWhisperSpeechRecognitionConstructor: () => { calls.push('whisper:constructor'); return Whisper; },
      preloadWhisperSpeechRecognition: async () => { calls.push('whisper:load'); },
      disposeWhisperSpeechRecognition: () => calls.push('whisper:dispose'),
    },
    '../utils/speechRecognitionSession': { createSpeechRecognitionSession: (Constructor, _onChange, options) => {
      configured = { Constructor, ...options };
      return { configure: () => {}, dispose: () => {} };
    } },
  }, { window: nativeAvailable ? { webkitSpeechRecognition: Native } : {}, navigator: {} });
  const result = hook.useSpeechRecognition({ enabled: false, lang: 'es-ES', lineKey: null, prepareLocal: true,
    ...(engine ? { engine } : {}) });
  const cleanups = effects.map(effect => effect()).filter(cleanup => typeof cleanup === 'function');
  return { result, configured, calls, Native, Vosk, Whisper, dispose: () => cleanups.forEach(cleanup => cleanup()) };
};

test('default Safari uses the native session and retains the iPhone natural-end protection without loading local models', () => {
  const f = hookFixture();
  assert.equal(f.configured.Constructor, f.Native);
  assert.equal(f.result.isLocal, false);
  assert.equal(f.configured.naturalEnd, true);
  assert.equal(typeof f.configured.prepareRestart, 'function');
  assert(!f.calls.some(call => /:constructor|:load/.test(call)));
  f.dispose();
});

test('only the installed bridge owns explicit native closure and bypasses the Safari restart cue', () => {
  const f=hookFixture({controlledEnd:true});
  assert.equal(f.configured.Constructor,f.Native);assert.equal(f.configured.controlledEnd,true);
  assert.equal(f.configured.naturalEnd,false);assert.equal(f.configured.prepareRestart,undefined);
  assert.equal(f.result.isLocal,false);f.dispose();
});

test('explicit Vosk uses Vosk even outside iOS and never silently substitutes Safari', () => {
  const f = hookFixture({ engine: 'vosk', ios: false });
  assert.equal(f.configured.Constructor, f.Vosk);
  assert.equal(f.result.isLocal, true);
  assert.equal(f.configured.naturalEnd, false);
  assert(f.calls.includes('vosk:load'));
  assert(!f.calls.some(call => call.startsWith('whisper:')));
  f.dispose();
  const unavailable = hookFixture({ engine: 'vosk', voskAvailable: false });
  assert.equal(unavailable.result.isSupported, false);
  assert.equal(unavailable.configured.Constructor, null);
  unavailable.dispose();
});

test('Safari unavailable stays unsupported and Whisper and comparison retain their own preparation adapter', () => {
  const unavailable = hookFixture({ nativeAvailable: false });
  assert.equal(unavailable.result.isSupported, false);
  assert(!unavailable.calls.some(call => /:constructor|:load/.test(call)));
  unavailable.dispose();
  for (const engine of ['whisper', 'comparison']) {
    const f = hookFixture({ engine });
    assert.equal(f.configured.Constructor, f.Whisper);
    assert.equal(f.result.isLocal, true);
    assert.equal(f.configured.naturalEnd, false);
    assert(f.calls.includes('whisper:load'));
    f.dispose();
    assert(f.calls.includes('whisper:dispose'));
  }
});
