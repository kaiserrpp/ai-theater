const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const previous = require.extensions['.ts'];
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { getRehearsalRecognitionAttempt: attempt } = require('../src/utils/rehearsalRecognitionAttempt.ts');
const { buildRehearsalRecognitionPlan: plan } = require('../src/utils/rehearsalRecognitionPlan.ts');
const { getAutomaticLineMatchReason: reason } = require('../src/utils/lineMatching.ts');
if (previous) require.extensions['.ts'] = previous; else delete require.extensions['.ts'];
const input = (expectedText, transcript, extra = {}) => ({ expectedText, transcript, lineKey: 'line-one', ...extra });

test('web selects each English reply from original script vocabulary without inventing native hint support', () => {
  const context = { names: ['Sonny', 'Benny', 'Nina'], vocabulary: ['English'] };
  for (const text of ['Ey, Sonny', 'Really?', 'Sure (se ríe)', 'Tengo noticias. My Enlgish is getting much better.']) {
    assert.equal(plan(text, context, 'native', false).lang, 'en-US', text);
    assert.equal(plan(text, context, 'native', false).hints, undefined);
    assert.ok(plan(text, context, 'native', true).hints.contextualStrings.includes('Sonny'));
  }
  for (const text of ['He visto la escena', 'Come conmigo', 'Pues sí que has traído nuevas palabras',
    'Ya lo sé pero hay dos idiomas distintos: Dominican English y Puerto riquean English; necesito unas lecciones extras']) {
    assert.equal(plan(text, context, 'native', false).lang, 'es-ES', text);
  }
  assert.equal(plan('Really?', context, 'vosk', false).lang, 'es-ES');
  assert.equal(plan('Really?', context, 'whisper', false).lang, 'es-ES');
});

test('two complete final repetitions recover the reported short negative line without changing raw words', () => {
  const raw = 'pero ya me diste uno hoy no pero no pero';
  const result = attempt(input('No, pero…', raw));
  assert.equal(result.source, 'repeated_line'); assert.equal(result.text, 'no pero');
  assert.equal(result.match.score, 1); assert.equal(reason('No, pero…', result.text, result.match), 'global_score');
  assert.equal(raw, 'pero ya me diste uno hoy no pero no pero');
  assert.equal(attempt(input('No, pero…', raw, { interimTranscript: 'no pero' })).source, 'accumulated');
  assert.equal(attempt(input('No, pero…', raw, { lineKey: null })).source, 'accumulated');
});

test('a new complete final utterance can replace an unsuccessful attempt on that same line', () => {
  const expected = 'Ey, Sonny', text = 'Ey, Sonny';
  const result = attempt(input(expected, 'se ha entendido cualquier cosa ' + text, {
    lastUtterance: { text, isFinal: true, lineKey: 'line-one' },
  }));
  assert.equal(result.source, 'latest_utterance'); assert.equal(result.text, text);
  assert.ok(reason(expected, result.text, result.match));
  const repeated = attempt(input('No, pero', 'no pero no pero', {
    lastUtterance: { text: 'no pero', isFinal: true, lineKey: 'line-one' },
  }));
  assert.equal(repeated.source, 'latest_utterance');
});

test('a pause or a fragmented continuation retains the accumulated line, including its negation', () => {
  const expected = 'No quiero salir de casa y prefiero terminar la escena aquí';
  const raw = 'No quiero salir de casa y prefiero terminar la escena aquí';
  const result = attempt(input(expected, raw, { lastUtterance: { text: 'terminar la escena aquí', isFinal: true, lineKey: 'line-one' } }));
  assert.equal(result.source, 'accumulated'); assert.equal(result.text, raw);
  const partial = attempt(input(expected, 'No quiero salir de casa', {
    lastUtterance: { text: 'No quiero salir de casa', isFinal: true, lineKey: 'line-one' },
  }));
  assert.equal(partial.source, 'accumulated'); assert.equal(reason(expected, partial.text, partial.match), null);
});

test('matching suffixes, provisional results, stale turns and changed negations cannot become clean attempts', () => {
  const expected = 'Quiero terminar el ensayo hoy';
  const result = (raw, text, extra = {}) => attempt(input(expected, raw, {
    lastUtterance: { text, isFinal: true, lineKey: 'line-one', ...extra },
  }));
  for (const [raw, text, extra] of [
    ['No ' + expected, expected, {}],
    ['No ' + expected + ' ' + expected, expected, {}],
    ['No quiero salir ' + expected, expected, {}],
    ['sin ' + expected, expected, {}],
    ['No quiero terminar el ensayo hoy', 'Quiero terminar el ensayo hoy', {}],
    ['Me he equivocado ' + expected, expected, { isFinal: false }],
    ['Me he equivocado ' + expected, expected, { lineKey: 'old-line' }],
  ]) assert.equal(result(raw, text, extra).source, 'accumulated', raw);
  assert.equal(attempt(input('No, pero', 'no no pero no pero')).source, 'accumulated');
  assert.equal(attempt(input('No quiero salir de casa y prefiero terminar la escena aquí', 'terminar la escena aquí terminar la escena aquí')).source, 'accumulated');
  assert.equal(attempt(input('I want to go home', "don't I want to go home", {
    lastUtterance: { text: 'I want to go home', isFinal: true, lineKey: 'line-one' },
  })).source, 'accumulated');
});
