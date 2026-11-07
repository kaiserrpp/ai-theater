const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { runRehearsalMicrophoneCalibration: calibrate, canBeginPreparedRehearsal: canStart } = require('../src/utils/rehearsalPreparation.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

const result = (status = 'ready', voiceLevel = 0.2) => ({ status, voiceLevel, noiseFloor: 0.01, voiceThreshold: 0.04, voiceToNoiseRatio: 20 });
const operations = (events, overrides = {}) => ({
  isCurrent: () => true,
  start: async () => { events.push('open'); },
  measureNoise: async () => { events.push('noise'); return result(); },
  prompt: async () => { events.push('prompt'); },
  beep: async () => { events.push('beep'); },
  measureVoice: async () => { events.push('voice'); return result(); },
  release: async () => { events.push('release'); },
  onStage: () => {}, ...overrides,
});

test('every calibration measures noise and voice, then releases the capture before recognition can start', async () => {
  const events = [];
  await calibrate(operations(events));
  await calibrate(operations(events));
  assert.deepEqual(events, ['open','noise','prompt','beep','voice','release','open','noise','prompt','beep','voice','release']);
});
test('a failed microphone or denied permission releases input without speaking or measuring voice', async () => {
  for (const failure of ['denied', 'noise']) {
    const events = [];
    await assert.rejects(calibrate(operations(events, failure === 'denied'
      ? { start: async () => { throw new Error('denied'); } }
      : { measureNoise: async () => result('error', 0) })), failure === 'denied' ? /denied/ : /microphone-unavailable/);
    assert.ok(events.includes('release'));
    assert.ok(!events.includes('prompt') && !events.includes('voice'));
  }
});
test('insufficient voice stays a failure and releases the calibration input', async () => {
  const events = [];
  await assert.rejects(calibrate(operations(events, { measureVoice: async () => result('error', 0) })), /voice-not-detected/);
  assert.equal(events.at(-1), 'release');
});
test('a cancelled calibration cannot start later steps or close the new session microphone', async () => {
  const events = [];
  let current = true;
  await assert.rejects(calibrate(operations(events, {
    isCurrent: () => current,
    measureNoise: async () => { current = false; return result(); },
  })), /preparation-cancelled/);
  assert.deepEqual(events, ['open']);
});
test('intelligent mode requires speaker, fresh calibration, live recognition and the final output confirmation', () => {
  const complete = { speakerConfirmed: true, microphoneCalibrated: true, recognitionAudioActive: true, speakerWithRecognitionConfirmed: true };
  assert.equal(canStart('intelligent', complete), true);
  for (const key of Object.keys(complete)) assert.equal(canStart('intelligent', { ...complete, [key]: false }), false, key);
});
test('silence mode requires calibration; manual mode still requires the actor to confirm the speaker', () => {
  const evidence = { speakerConfirmed: true, microphoneCalibrated: false, recognitionAudioActive: false, speakerWithRecognitionConfirmed: false };
  assert.equal(canStart('auto', evidence), false);
  assert.equal(canStart('auto', { ...evidence, microphoneCalibrated: true }), true);
  assert.equal(canStart('manual', evidence), true);
  assert.equal(canStart('manual', { ...evidence, speakerConfirmed: false }), false);
});
