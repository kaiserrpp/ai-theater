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

const result = (text, isFinal = true) => ({ isFinal, 0: { transcript: text } });
const commandSession = (t, acceptInterim = false) => {
  let handle, advances = 0;
  class Recognition { constructor() { handle = this; } start() {} abort() { this.aborted = true; } }
  const command = { accepts: isCommand, acceptInterim, onRecognized: () => {
    assert.equal(handle.aborted, true, 'the listening window closes before entering the scene');
    advances++;
  } };
  const session = createSpeechRecognitionSession(Recognition, () => {}, { getCommand: key => key === 'scene:3' ? command : undefined });
  session.activate({ lang: 'es-ES', lineKey: 'scene:3' });
  handle.onaudiostart();
  t.after(session.dispose);
  return { session, emit: handle.onresult, advances: () => advances };
};

test('a final command is consumed before a later update can replace it, with no carryover from conversation', t => {
  const { session, emit, advances } = commandSession(t);
  emit({ results: [result('Espera un momento')] });
  emit({ results: [result('adelante', false)] });
  emit({ results: [result('adelante con los ensayos')] });
  emit({ results: [result('no adelante')] });
  assert.equal(advances(), 0);
  emit({ results: [result('no adelante'), result('¡Adelante!')] });
  emit({ results: [result('otra conversación', false)] });
  assert.equal(advances(), 1);
  assert.equal(session.getSnapshot().transcript, '¡Adelante!');
});

test('Whisper can use its standalone provisional command after a finalized unrelated utterance', t => {
  const { emit, advances } = commandSession(t, true);
  emit({ results: [result('No adelante', false)] });
  emit({ results: [result('Espera un momento'), result('Adel', false)] });
  assert.equal(advances(), 0);
  emit({ results: [result('Espera un momento'), result('¡Adelante!', false)] });
  assert.equal(advances(), 1);
});

test('a Vosk partial retraction does not replay the recognizer result history as a command', t => {
  const { emit, advances } = commandSession(t);
  emit({ results: [result('adelante'), result('un momento', false)], resultIndex: 1 });
  emit({ results: [result('adelante')], resultIndex: 1 });
  assert.equal(advances(), 0);
  emit({ results: [result('adelante'), result('adelante')], resultIndex: 1 });
  assert.equal(advances(), 1);
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
