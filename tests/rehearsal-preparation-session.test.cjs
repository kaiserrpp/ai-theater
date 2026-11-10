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
      session.confirmRecognitionOutput();
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

test('repeat clears every check; a newly opened app starts with no prior evidence', () => {
  const session = createSession();
  const updates = [];
  const unsubscribe = session.subscribe(() => updates.push(session.getSnapshot()));
  session.confirmSpeaker(); session.rememberCalibration(calibration); session.confirmRecognitionOutput();
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
  session.confirmSpeaker(); session.rememberCalibration(calibration); session.confirmRecognitionOutput();
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
