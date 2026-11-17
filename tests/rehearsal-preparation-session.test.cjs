const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { createRehearsalPreparationSession: createSession, getRehearsalPreparationStep: nextStep } = require('../src/utils/rehearsalPreparationSession.ts');
const { canBeginPreparedRehearsal: canStart, runRehearsalMicrophoneCalibration: calibrate } = require('../src/utils/rehearsalPreparation.ts');
const { createSpeechRecognitionSession } = require('../src/utils/speechRecognitionSession.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

const calibration = { status: 'ready', noiseFloor: 0.01, voiceLevel: 0.2, voiceThreshold: 0.04, voiceToNoiseRatio: 20 };
test('changing the measurement scale can retire calibration without losing the confirmed speaker or engine evidence', () => {
  const session = createSession(); session.confirmSpeaker();
  session.rememberCalibration({ ...calibration, measurement: 'native_peak' });
  session.confirmRecognitionOutput('prueba de micro', 'native');
  assert.equal(session.getSnapshot().calibration.measurement, 'native_peak');
  session.resetCalibration(); assert.equal(session.getSnapshot().calibration, null);
  assert.equal(session.getSnapshot().speakerConfirmed, true); assert.equal(session.hasConfirmedRecognitionEngine('native'), true);
  assert.equal(nextStep('intelligent', session.getSnapshot()), 'microphone');
});
test('switching recognition engines preserves speaker and calibration but requires words from the new engine', () => {
  const session = createSession(); session.confirmSpeaker(); session.rememberCalibration(calibration);
  session.confirmRecognitionOutput('prueba de micro', 'vosk');
  assert.equal(session.hasConfirmedRecognitionEngine('vosk'), true);
  assert.equal(session.hasConfirmedRecognitionEngine('whisper'), false);
  session.confirmRecognitionOutput('', 'whisper');
  assert.equal(session.hasConfirmedRecognitionEngine('whisper'), false);
  session.confirmRecognitionOutput('Prueba de micro.', 'whisper');
  assert.equal(session.hasConfirmedRecognitionEngine('whisper'), true);
  assert.equal(session.getSnapshot().speakerConfirmed, true);
  assert.ok(session.getSnapshot().calibration);
  session.reset();
  assert.equal(session.hasConfirmedRecognitionEngine('vosk'), false);
  assert.equal(session.hasConfirmedRecognitionEngine('whisper'), false);
});
const evidence = (session, recognition) => ({
  speakerConfirmed: session.getSnapshot().speakerConfirmed,
  microphoneCalibrated: Boolean(session.getSnapshot().calibration),
  speakerWithRecognitionConfirmed: session.getSnapshot().recognitionOutputConfirmed,
  recognitionAudioActive: recognition?.getSnapshot().isAudioActive ?? false,
});

test('one successful calibration and speaker check cover the first rehearsal and five more', async () => {
  const session = createSession();
  const events = [];
  assert.equal(nextStep('auto', session.getSnapshot()), 'speaker');
  assert.equal(nextStep('intelligent', session.getSnapshot()), 'speaker');
  session.confirmSpeaker();
  assert.equal(nextStep('auto', session.getSnapshot()), 'microphone');
  session.rememberCalibration(await calibrate({
    isCurrent: () => true,
    prepareOutput: async () => { events.push('output'); },
    start: async () => { events.push('open'); },
    measureNoise: async () => { events.push('noise'); return calibration; },
    prompt: async () => { events.push('prompt'); },
    beep: async () => { events.push('beep'); },
    measureVoice: async () => { events.push('voice'); return calibration; },
    release: async () => { events.push('release'); },
    onStage: () => {},
  }));
  for (let rehearsal = 0; rehearsal < 6; rehearsal += 1) {
    assert.equal(nextStep('auto', session.getSnapshot()), 'ready');
    assert.equal(canStart('auto', evidence(session)), true);
    assert.equal(nextStep('manual', session.getSnapshot()), 'ready');
    assert.equal(canStart('manual', evidence(session)), true);
    assert.deepEqual(session.getSnapshot().calibration, calibration);
  }
  assert.deepEqual(events, ['output', 'open', 'noise', 'release', 'prompt', 'beep', 'open', 'voice', 'release']);
});

test('six intelligent rehearsals reuse output checks but require a new real audio-start event each time', () => {
  const session = createSession();
  session.confirmSpeaker(); session.rememberCalibration(calibration);
  const handles = [];
  class Recognition {
    constructor() { handles.push(this); }
    start() {}
    abort() { this.aborted = true; }
  }
  for (let rehearsal = 0; rehearsal < 6; rehearsal += 1) {
    assert.equal(nextStep('intelligent', session.getSnapshot()), 'recognition');
    const recognition = createSpeechRecognitionSession(Recognition, () => {});
    recognition.activate({ lang: 'es-ES', lineKey: `work-${rehearsal}:prepare` });
    assert.equal(canStart('intelligent', evidence(session, recognition)), false);
    handles.at(-1).onaudiostart();
    if (rehearsal === 0) {
      assert.equal(canStart('intelligent', evidence(session, recognition)), false);
      session.confirmRecognitionOutput('');
      assert.equal(session.getSnapshot().recognitionOutputConfirmed, false);
      handles.at(-1).onresult({ results: [{ isFinal: true, 0: { transcript: 'Prueba de micro' } }] });
      session.confirmRecognitionOutput(recognition.getSnapshot().transcript);
    }
    assert.equal(canStart('intelligent', evidence(session, recognition)), true);
    recognition.dispose();
    assert.equal(handles.at(-1).aborted, true);
    assert.equal(session.getSnapshot().recognitionOutputConfirmed, true);
  }
  assert.equal(handles.length, 6);
});

test('manual checks stay useful when enabling the microphone for the first time', () => {
  const session = createSession(); session.confirmSpeaker();
  assert.equal(nextStep('manual', session.getSnapshot()), 'ready');
  assert.equal(nextStep('auto', session.getSnapshot()), 'microphone');
  assert.equal(nextStep('intelligent', session.getSnapshot()), 'microphone');
  session.rememberCalibration(calibration);
  assert.equal(nextStep('auto', session.getSnapshot()), 'ready');
  assert.equal(nextStep('intelligent', session.getSnapshot()), 'recognition');
  assert.equal(session.getSnapshot().recognitionOutputConfirmed, false);
});

test('failed or incomplete measurements never count as completed calibration', () => {
  const session = createSession(); session.confirmSpeaker();
  session.confirmRecognitionOutput();
  assert.equal(session.getSnapshot().recognitionOutputConfirmed, false);
  for (const invalid of [{ status: 'error' }, { status: 'idle' }, { status: 'measuring-voice' },
    { voiceLevel: 0 }, { voiceLevel: NaN }, { noiseFloor: Infinity }, { voiceThreshold: -1 }]) {
    session.rememberCalibration({ ...calibration, ...invalid });
    assert.equal(nextStep('auto', session.getSnapshot()), 'microphone');
  }
  session.rememberCalibration({ ...calibration, status: 'weak' });
  assert.equal(nextStep('auto', session.getSnapshot()), 'ready');
});

test('repeat clears every check; an unconfigured memory session starts with no prior evidence', () => {
  const session = createSession();
  const updates = [];
  const unsubscribe = session.subscribe(() => updates.push(session.getSnapshot()));
  session.confirmSpeaker(); session.rememberCalibration(calibration); session.confirmRecognitionOutput('prueba de micro');
  const confirmed = session.getSnapshot();
  session.reset();
  assert.equal(nextStep('manual', session.getSnapshot()), 'speaker');
  assert.equal(nextStep('intelligent', session.getSnapshot()), 'speaker');
  assert.equal(session.getSnapshot().recognitionOutputConfirmed, false);
  assert.equal(confirmed.speakerConfirmed, true);
  assert.equal(Object.isFrozen(confirmed.calibration), true);
  assert.deepEqual(createSession().getSnapshot(), session.getSnapshot());
  assert.equal(updates.length, 4);
  unsubscribe(); session.confirmSpeaker();
  assert.equal(updates.length, 4);
});

test('a denied recognition session cannot use prior checks to pretend audio is live', () => {
  const session = createSession();
  session.confirmSpeaker(); session.rememberCalibration(calibration); session.confirmRecognitionOutput('prueba de micro');
  let handle;
  class Recognition {
    constructor() { handle = this; }
    start() {}
    abort() {}
  }
  const recognition = createSpeechRecognitionSession(Recognition, () => {});
  recognition.activate({ lang: 'es-ES', lineKey: 'prepare' });
  handle.onerror({ error: 'not-allowed' });
  assert.equal(canStart('intelligent', evidence(session, recognition)), false);
  assert.equal(recognition.getSnapshot().status, 'error');
  assert.equal(session.getSnapshot().recognitionOutputConfirmed, true);
  recognition.dispose();
});

const storageFixture = () => {
  const values = new Map();
  const storage = { key: 'audio-test:browser', context: 'browser',
    read: async key => values.get(key) || null,
    write: async (key, value) => { values.set(key, value); },
  };
  return { values, storage };
};
const confirm = session => {
  session.confirmSpeaker(); session.rememberCalibration(calibration);
  session.confirmRecognitionOutput('prueba de micro', 'native');
};

test('saved speaker, calibration and per-engine checks survive closing the app without retaining permission or audio', async () => {
  const f = storageFixture(), first = createSession(f.storage); await first.load();
  first.confirmSpeaker(); first.rememberCalibration({ ...calibration, audio: [0.42], deviceId: 'private-device' });
  first.confirmRecognitionOutput('prueba de micro', 'native'); await first.flush();
  const serialized = f.values.get(f.storage.key);
  assert.equal(serialized.includes('0.42'), false); assert.equal(serialized.includes('private-device'), false);
  assert.equal(serialized.includes('prueba de micro'), false);
  const restored = createSession(f.storage); assert.equal(restored.getSnapshot().loaded, false);
  await restored.load(); assert.equal(restored.getSnapshot().loaded, true);
  assert.equal(restored.getSnapshot().speakerConfirmed, true);
  assert.equal(restored.getSnapshot().calibration.voiceThreshold, calibration.voiceThreshold);
  assert.equal(restored.hasConfirmedRecognitionEngine('native'), true);
  assert.equal(restored.hasConfirmedRecognitionEngine('whisper'), false);
  assert.equal(nextStep('intelligent', restored.getSnapshot()), 'recognition', 'a saved profile never means capture is currently open');
  assert.equal(canStart('intelligent', evidence(restored)), false);
  assert.equal(nextStep('auto', restored.getSnapshot()), 'ready');
  assert.equal(nextStep('manual', restored.getSnapshot()), 'ready');
});

test('opting out keeps the current open session useful and removes saved checks from the next app launch', async () => {
  const f = storageFixture(), current = createSession(f.storage); await current.load(); confirm(current); await current.flush();
  current.setRemember(false); await current.flush();
  assert.equal(current.getSnapshot().speakerConfirmed, true);
  const restored = createSession(f.storage); await restored.load();
  assert.equal(restored.getSnapshot().remember, false); assert.equal(restored.getSnapshot().speakerConfirmed, false);
  assert.equal(restored.getSnapshot().calibration, null); assert.equal(restored.hasConfirmedRecognitionEngine('native'), false);
  current.setRemember(true); await current.flush();
  const enabled = createSession(f.storage); await enabled.load(); assert.equal(enabled.getSnapshot().speakerConfirmed, true);
});

test('repeat tests removes only this audio profile and remains cleared after a reload', async () => {
  const f = storageFixture(), current = createSession(f.storage); f.values.set('unrelated-songs', 'keep');
  await current.load(); confirm(current); await current.flush(); current.reset(); await current.flush();
  const restored = createSession(f.storage); await restored.load();
  assert.equal(nextStep('intelligent', restored.getSnapshot()), 'speaker');
  assert.equal(restored.hasConfirmedRecognitionEngine('native'), false);
  assert.equal(f.values.get('unrelated-songs'), 'keep');
});

test('a late restore cannot undo a reset, an opt-out or a new confirmed calibration', async () => {
  const f = storageFixture(), first = createSession(f.storage); await first.load(); confirm(first); await first.flush();
  const saved = f.values.get(f.storage.key);
  for (const change of [session => session.reset(), session => session.setRemember(false), session => { session.confirmSpeaker(); session.rememberCalibration({ ...calibration, voiceThreshold: .09 }); }]) {
    let complete;
    const session = createSession({ ...f.storage, read: () => new Promise(resolve => { complete = resolve; }) });
    const loading = session.load(); change(session); const expected = session.getSnapshot();
    complete(saved); await loading; await session.flush();
    assert.equal(session.getSnapshot().speakerConfirmed, expected.speakerConfirmed);
    assert.equal(session.getSnapshot().remember, expected.remember);
    assert.deepEqual(session.getSnapshot().calibration, expected.calibration);
    assert.equal(session.hasConfirmedRecognitionEngine('native'), false);
  }
});

test('corrupt, incompatible and out of range saved values do not bypass first setup', async () => {
  const f = storageFixture();
  const valid = { version: 1, context: 'browser', remember: true, speakerConfirmed: true, calibration, engines: ['native'] };
  for (const invalid of ['{broken', JSON.stringify({ ...valid, version: 999 }), JSON.stringify({ ...valid, context: 'native-android-peak' }),
    JSON.stringify({ ...valid, calibration: { ...calibration, voiceThreshold: 4 } }),
    JSON.stringify({ ...valid, calibration: { ...calibration, status: 'error' } }),
    JSON.stringify({ ...valid, engines: ['made-up'] })]) {
    f.values.set(f.storage.key, invalid); const session = createSession(f.storage); await session.load();
    assert.equal(nextStep('intelligent', session.getSnapshot()), 'speaker');
    assert.equal(session.getSnapshot().loaded, true); assert.ok(session.getSnapshot().storageError);
  }
});

test('browser and native profiles stay separate, and retiring only calibration keeps speaker and engine checks', async () => {
  const f = storageFixture(), session = createSession(f.storage); await session.load(); confirm(session); await session.flush();
  session.resetCalibration(); await session.flush();
  const restored = createSession(f.storage); await restored.load();
  assert.equal(restored.getSnapshot().calibration, null); assert.equal(restored.getSnapshot().speakerConfirmed, true);
  assert.equal(restored.hasConfirmedRecognitionEngine('native'), true);
  restored.configurePersistence({ ...f.storage, key: 'audio-test:native-android-peak', context: 'native-android-peak' });
  await restored.load(); assert.equal(restored.getSnapshot().speakerConfirmed, false);
  assert.equal(restored.hasConfirmedRecognitionEngine('native'), false);
  assert.ok(f.values.has('audio-test:browser'));
});

test('read/write failures report persistence honestly and a later successful save clears the error', async () => {
  const f = storageFixture(); let fail = true;
  const session = createSession({ ...f.storage, write: async (...args) => { if (fail) throw new Error('full'); await f.storage.write(...args); } });
  await session.load(); confirm(session); await session.flush();
  assert.equal(session.getSnapshot().speakerConfirmed, true); assert.ok(session.getSnapshot().storageError);
  assert.equal(f.values.size, 0); fail = false; session.confirmSpeaker(); await session.flush();
  assert.equal(session.getSnapshot().storageError, null);
  let readFailed = true;
  const retry = createSession({ ...f.storage, read: async key => { if (readFailed) throw new Error('temporarily unavailable'); return f.storage.read(key); } });
  await retry.load(); assert.equal(retry.getSnapshot().speakerConfirmed, false); assert.ok(retry.getSnapshot().storageError);
  readFailed = false; await retry.load(); assert.equal(retry.getSnapshot().speakerConfirmed, true);
});
