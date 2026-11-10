const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { getAutomaticRehearsalTargetIndex: advance, isSceneAdvanceCommand: isCommand,
  startRehearsalSceneAnnouncement: announce } = require('../src/utils/rehearsalSceneTransition.ts');
const { createSpeechRecognitionSession } = require('../src/utils/speechRecognitionSession.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

const lines = [
  { p: 'ESCENA_SISTEMA', t: 'Primera' },
  { p: 'ANA', t: 'Hola.' },
  { p: 'CANCION_SISTEMA', t: 'Canción' },
  { p: 'ESCENA_SISTEMA', t: 'Segunda' },
  { p: 'LUIS', t: 'Hasta mañana.' },
  { p: 'ESCENA_SISTEMA', t: 'Final' },
  { p: 'ANA', t: 'Adiós.' },
];

test('dialogue and silence advance within a scene and wait indefinitely at every scene marker', () => {
  assert.equal(advance(lines, 1), 2);
  assert.equal(advance(lines, 2), 3);
  for (const marker of [0, 3, 5]) {
    for (let callback = 0; callback < 10; callback += 1) {
      assert.equal(advance(lines, marker), marker);
    }
  }
  assert.equal(advance(lines, 6), 7);
  assert.equal(advance(lines, 7), 7);
});

test('musical completion and timeline cues stop at the first scene even when their target is later', () => {
  assert.equal(advance(lines, 1, 6), 3);
  assert.equal(advance(lines, 2, lines.length), 3);
  assert.equal(advance(lines, 3, 6), 3);
  assert.equal(advance(lines, 4, 100), 5);
  assert.equal(advance(lines, 4, 2), 4);
});

test('only an explicit adelante command starts a scene; announcements and ordinary dialogue do not', () => {
  for (const command of ['adelante', '¡Adelante!', ' ADELANTE. ']) assert.equal(isCommand(command), true);
  for (const other of ['', 'siguiente línea', 'Siguiente escena: Adelante', 'No sigas adelante', 'Adelante con los ensayos']) {
    assert.equal(isCommand(other), false, other);
  }
});

test('announcements release the silence detector first and finishing the voice leaves the scene waiting', async () => {
  const events = [];
  let completeRelease;
  let voice;
  let index = 3;
  let ready = false;
  const cancel = announce({
    title: lines[index].t,
    releaseInput: () => new Promise((resolve) => { events.push('release'); completeRelease = resolve; }),
    speak: (text, callbacks) => { events.push(text); voice = callbacks; },
    stop: () => events.push('stop'),
    onReady: (error) => { assert.equal(error, null); ready = true; },
  });
  assert.deepEqual(events, ['release']);
  completeRelease();
  await Promise.resolve();
  assert.deepEqual(events, ['release', 'Siguiente escena: Segunda']);
  assert.equal(ready, false);
  voice.onDone();
  assert.equal(ready, true);
  index = advance(lines, index);
  assert.equal(index, 3);
  cancel();
  assert.equal(events.at(-1), 'stop');
});

test('pressing next or exiting cancels a pending announcement and ignores late callbacks', async () => {
  let completeRelease;
  let spoken = 0;
  let ready = 0;
  const pending = announce({
    title: 'Primera',
    releaseInput: () => new Promise((resolve) => { completeRelease = resolve; }),
    speak: () => { spoken += 1; }, stop: () => {}, onReady: () => { ready += 1; },
  });
  pending();
  completeRelease();
  await Promise.resolve();
  assert.equal(spoken, 0);
  assert.equal(ready, 0);

  let voice;
  const playing = announce({
    title: 'Segunda', releaseInput: async () => {},
    speak: (_, callbacks) => { voice = callbacks; }, stop: () => {}, onReady: () => { ready += 1; },
  });
  await Promise.resolve();
  playing();
  voice.onDone();
  voice.onError(new Error('cancelled'));
  assert.equal(ready, 0);
});

test('voice errors still permit an explicit command and report the problem only once', async () => {
  const errors = [];
  let voice;
  const cancel = announce({
    title: 'Final', releaseInput: async () => {},
    speak: (_, callbacks) => { voice = callbacks; }, stop: () => {}, onReady: (error) => errors.push(error),
  });
  await Promise.resolve();
  voice.onError(new Error('speech-synthesis-unavailable'));
  voice.onDone();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'speech-synthesis-unavailable');
  cancel();
});

test('scene announcement echoes and conversation are discarded before a fresh adelante command', () => {
  let handle;
  class Recognition {
    constructor() { handle = this; }
    start() {}
    abort() {}
  }
  const session = createSpeechRecognitionSession(Recognition, () => {});
  const result = (text, isFinal = true) => ({ isFinal, 0: { transcript: text } });
  session.activate({ lang: 'es-ES', lineKey: 'scene:3' });
  handle.onaudiostart();
  handle.onresult({ results: [result('Siguiente escena: Segunda', false)] });
  session.resetTranscript(); // Announcement finished; arm the command.
  handle.onresult({ results: [result('Siguiente escena: Segunda')] });
  assert.equal(isCommand(session.getSnapshot().finalTranscript), false);
  handle.onresult({ results: [result('Siguiente escena: Segunda'), result('Espera un momento')] });
  assert.equal(isCommand(session.getSnapshot().finalTranscript), false);
  session.resetTranscript();
  handle.onresult({ results: [result('Siguiente escena: Segunda'), result('Espera un momento'), result('¡Adelante!', false)] });
  assert.equal(isCommand(session.getSnapshot().finalTranscript), false);
  handle.onresult({ results: [result('Siguiente escena: Segunda'), result('Espera un momento'), result('¡Adelante!')] });
  assert.equal(isCommand(session.getSnapshot().finalTranscript), true);
  session.dispose();
});
