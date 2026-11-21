const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const previous = require.extensions['.ts'];
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { scoreLineMatch: score, getAutomaticLineMatchReason: reason, getAutomaticLineAdvanceDelay: delay } = require('../src/utils/lineMatching.ts');
const { getRehearsalRecognitionAttempt: attempt } = require('../src/utils/rehearsalRecognitionAttempt.ts');
if (previous) require.extensions['.ts'] = previous; else delete require.extensions['.ts'];
const accepts = (expected, heard, continuous = true) => delay(expected, heard, heard, score(expected, heard), continuous);
const dialects = 'Ya lo sé pero hay dos idiomas distintos: Dominican English y Puerto riquean English… necesito unas lecciones extras';
const yesterday = 'No, pero espera. Respecto a ayer, No te encontraba por ningún lado, la abuela se sentía mal tenía que volver a buscarla';

test('continuous iPhone results can finish already accepted flexible lines without waiting for isFinal', () => {
  for (const [expected, heard] of [
    [dialects, 'Ya lo sé es que son dos idiomas distintos Dominican English y puertorriqueña en English voy a necesitar lecciones extras'],
    [dialects, 'Es que son dos idiomas distintos Dominican English y Puerto Rico en English necesitar lecciones extras'],
    ['Pero es que yo trate de llamar', 'Yo traté de llamar'],
  ]) {
    assert.ok(reason(expected, heard, score(expected, heard)), 'the existing match already accepts this line');
    assert.equal(accepts(expected, heard, false), null, 'retain the other recognizers\' interim policy');
    assert.equal(accepts(expected, heard), 120, heard);
  }
});

test('omitting a separate conversational preface preserves the negative statement in the rest of a long reply', () => {
  const heard = 'Respecto ayer no te encontraba por ningún sitio además la abuela se sentía mal y tuve que volver a buscarla';
  const match = score(yesterday, heard);
  assert.equal(match.negationPenaltyApplied, false);
  assert.ok(!match.referenceText.startsWith('No, pero espera.'));
  assert.notEqual(accepts(yesterday, heard), null);
  assert.equal(accepts(yesterday, heard.replace('no te encontraba', 'te encontraba')), null);
  assert.equal(accepts(yesterday, 'No, pero espera. ' + heard.replace('no te encontraba', 'te encontraba')), null);
  assert.equal(accepts('No pero, espera', 'Pero espera espera'), null);
  assert.equal(score('No, pero espera a tu hermano antes de salir de la casa', 'Espera a tu hermano antes de salir de la casa').negationPenaltyApplied, true);
});

test('a pause, missing last word, negation, repeated ending or unrelated tail cannot use flexible interim acceptance', () => {
  for (const [expected, heard] of [
    [dialects, 'Es que son dos idiomas distintos Dominican English y Puerto Rico en English necesitar lecciones'],
    [dialects, 'No son dos idiomas distintos Dominican English y Puerto Rico en English necesitar lecciones extras'],
    ['Pero es que yo trate de llamar', 'Yo traté'],
    ['Pero es que yo trate de llamar', 'Yo no traté de llamar'],
    [yesterday, 'Respecto ayer no te encontraba por ningún sitio además la abuela se sentía mal y tuve que volver'],
    ['Quería volver a buscarla, pero antes de volver a buscarla', 'Quería volver a buscarla'],
    ['Quiero recoger las cartas y después llamar a mi hermano', 'Quiero recoger las cartas'],
    ['Ey, Sonny', 'Sonny'],
  ]) assert.equal(accepts(expected, heard), null, `${expected}: ${heard}`);
});

test('two full repetitions in one continuous iPhone hypothesis recover the new attempt, without selecting arbitrary suffixes', () => {
  const raw = 'Ya me diste uno hoy no pero No pero';
  const input = { expectedText: 'No, pero…', transcript: raw, interimTranscript: raw, lineKey: 'current', allowRepeatedInterim: true };
  const result = attempt(input);
  assert.equal(result.source, 'repeated_line');
  assert.equal(result.text, 'No pero');
  assert.equal(result.match.score, 1);
  assert.equal(attempt({ ...input, allowRepeatedInterim: false }).source, 'accumulated');
  for (const transcript of ['Ya me diste uno hoy no pero', 'No no pero no pero', 'No pero no', 'No pero no pera']) {
    assert.equal(attempt({ ...input, transcript, interimTranscript: transcript }).source, 'accumulated', transcript);
  }
  assert.equal(attempt({ ...input, lineKey: null }).source, 'accumulated');
  const long = 'No quiero salir de casa y prefiero terminar la escena aquí';
  assert.equal(attempt({ ...input, expectedText: long, transcript: 'terminar la escena aquí terminar la escena aquí' }).source, 'accumulated');
});
