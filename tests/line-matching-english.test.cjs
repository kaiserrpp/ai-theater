const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { normalizeSpeechText, scoreLineMatch, getAutomaticLineMatchReason: reason,
  getAutomaticLineAdvanceDelay: delay } = require('../src/utils/lineMatching.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

const englishLine = 'Tengo noticias. My Enlgish is getting much better.';
const dialectLine = 'Ya lo sé pero hay dos idiomas distintos: Dominican English y Puerto riquean English… necesito unas lecciones extras';
const mixedTranscripts = [
  'tengo noticias mae english es jardín matt better',
  'tengo noticias may english macbeth',
  'tengo noticias más inglés es que más macbeth',
  'tengo noticias muy english ketty macbeth',
  'tengo noticias nuevas más inglés isleta macbeth era',
];
const accepts = (expected, heard, interim = heard) => {
  const match = scoreLineMatch(expected, heard);
  return delay(expected, heard, interim, match) !== null;
};

test('all five reported mixed English phrases accept both provisional and final recognition', () => {
  for (const heard of mixedTranscripts) {
    const match = scoreLineMatch(englishLine, heard);
    assert.equal(reason(englishLine, heard, match), 'global_score', heard);
    assert.equal(delay(englishLine, heard, heard, match), 60, heard);
    assert.equal(delay(englishLine, heard, '', match), 0, heard);
    assert.equal(match.referenceText, englishLine, 'keep the original script as the report reference');
  }
});

test('a pause before the recognized English ending cannot complete the mixed phrase', () => {
  for (const heard of [
    '', 'tengo noticias', 'tengo noticias my english', 'tengo noticias may english',
    'tengo noticias mae english es jardín', 'tengo noticias mae english es jardín matt',
    'tengo noticias más inglés es que más', 'tengo noticias muy english ketty',
    'tengo noticias nuevas más inglés isleta', 'macbeth',
  ]) {
    assert.equal(accepts(englishLine, heard), false, heard);
    assert.equal(accepts(englishLine, heard, ''), false, heard);
  }
});

test('short English sound confusions apply only to the corresponding one-word script line', () => {
  for (const [expected, heard] of [
    ['Really?', 'riley'], ['Really?', 'willy'],
    ['Sure (se rie)', 'sur'], ['Sure (se rie)', 'sur hasta'],
  ]) {
    assert.equal(accepts(expected, heard), true, `${expected}: ${heard}`);
    assert.equal(accepts(expected, heard, ''), true, `${expected}: ${heard}`);
  }
  for (const [expected, heard] of [
    ['Really?', 'nureddin'], ['Really?', ''], ['Really?', 'sur'],
    ['Sure (se rie)', 'sobre'], ['Sure (se rie)', ''], ['Sure (se rie)', 'riley'],
    ['Ey, sonny', 'esta ni eh salí'], ['Ey, sonny', 'esa sane'],
    ['Ey, sonny', 'y'], ['Ey, sonny', 'esa ley'], ['Ey, sonny', ''],
    ['Pues sí que has traido nuevas palabras', 'pues sí extraído palabras nómadas'],
  ]) {
    assert.equal(accepts(expected, heard), false, `${expected}: ${heard}`);
    assert.equal(accepts(expected, heard, ''), false, `${expected}: ${heard}`);
  }
});

test('Spanish transcriptions of the dialect names improve without losing their final phrase', () => {
  for (const heard of [
    'ya lo sé pero hay días en dos idiomas distintos dominicana inglés y puertorriqueña inglés necesito unas lecciones extras',
    'ya lo sé pero es hay dos idiomas distintos dominicana y puerto rico en inglés necesito unas lecciones de extras',
    'claro siempre hay dos idiomas distintos dominicana inglés y puertorriqueña en inglés necesito unas lecciones extras',
    'sí hay dos idiomas distintos dominicana inglés en puertorriqueña en inglés necesito unas lecciones extras',
  ]) assert.equal(accepts(dialectLine, heard, ''), true, heard);
  const paraphrase = 'es que hay dos idiomas distintos dominicana inglés y puertorriqueña en inglés necesito unas clases extras';
  assert.equal(accepts(dialectLine, paraphrase, ''), true);
  assert.equal(accepts(dialectLine, 'hay dos idiomas distintos dominicana inglés y puertorriqueña en inglés'), false);
});

test('the new corrections preserve negations and cannot rescue a negated English phrase', () => {
  for (const heard of mixedTranscripts) {
    const negated = `no ${heard}`;
    assert.equal(accepts(englishLine, negated), false, negated);
    assert.equal(accepts(englishLine, negated, ''), false, negated);
    assert.equal(scoreLineMatch(englishLine, negated).negationPenaltyApplied, true);
    assert.equal(accepts(`No ${englishLine}`, negated, ''), true, negated);
  }
  assert.equal(accepts('Really?', 'no riley', ''), false);
  assert.equal(accepts('Sure', 'no sur', ''), false);
});

test('Spanish words, names and other English sentences retain their original meaning', () => {
  assert.equal(normalizeSpeechText('sur Willy Riley Macbeth inglés'), 'sur willy riley macbeth ingles');
  for (const value of ['Sur', 'Willy', 'Riley', 'Macbeth', 'El sur queda lejos']) {
    assert.equal(accepts(value, value), true, value);
  }
  for (const [expected, heard] of [
    ['Sur', 'sure'], ['Willy', 'really'], ['Riley', 'really'], ['Macbeth', 'much better'],
    ['My English is getting worse', 'may english macbeth'],
    ['Tengo noticias sobre Macbeth', 'tengo noticias may english macbeth'],
  ]) assert.equal(accepts(expected, heard, ''), false, `${expected}: ${heard}`);
  assert.equal(accepts(englishLine, 'Tengo noticias. My English is getting much better.'), true);
  assert.equal(accepts(dialectLine, dialectLine), true);
});
