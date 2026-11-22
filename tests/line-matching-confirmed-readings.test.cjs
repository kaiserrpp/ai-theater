const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const previous = require.extensions['.ts'];
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { scoreLineMatch: score, getAutomaticLineAdvanceDelay: delay, normalizeSpeechText } = require('../src/utils/lineMatching.ts');
const { isHomeRehearsalCommand } = require('../src/utils/voiceAdvance.ts');
const { isSceneAdvanceCommand } = require('../src/utils/rehearsalSceneTransition.ts');
if (previous) require.extensions['.ts'] = previous; else delete require.extensions['.ts'];
const accepts = (expected, heard, interim = heard) => delay(expected, heard, interim, score(expected, heard), true) !== null;
const dialects = 'Ya lo sé pero hay dos idiomas distintos: Dominican English y Puerto riquean English… necesito unas lecciones extras';
const crystals = 'No, no, quiero estar un rato solo, con mis cristales rotos';
const news = 'Tengo noticias. My Enlgish is getting much better.';
const yesterday = 'No, pero espera. Respecto a ayer, No te encontraba por ningún lado, la abuela se sentía mal tenía que volver a buscarla';
const confirmed = [
  [dialects, 'Ya lo sé pero es que son dos idiomas distintos en English y puertorriqueña en English lecciones extras'],
  ['Pues sí que has traido nuevas palabras', 'Pues sigues traído nuevas palabras'],
  ['Pues sí que has traido nuevas palabras', 'Pues siguieras traído palabras nuevas'],
  ['Pues sí que has traido nuevas palabras', 'Pues sigues has aprendido palabras nuevas'],
  ['Por favor Carla, acompáñala y que se quede en la sombra ¿sí?', 'Por favor acompáñala y que se queden las sombras así'],
  [crystals, 'Solo con mis cristales rotos'], [crystals, 'Quiero estar solo con mis cristales rotos'],
  ['No pero, espera', 'Pero espera espera espera'], ['No pero, espera', 'Espera no espera'], ['No pero, espera', 'Espera'],
  ['Abuela, que paso? Porque gritas? Paso algo malo?', 'Por qué gritas algo malo'],
  ['No, pero…', 'Pero'], ['Para que?', 'Qué'], ['Ey, sonny', 'Sonny'],
  ['Ey, sonny', 'sane'], ['Ey, sonny', 'esta ni'], ['Ey, sonny', 'y a dani'],
  ['Really?', 'lee fraile'], ['Really?', 'lee royale'], ['Sure (se rie)', 'sour'],
  [news, 'tengo noticias may ingleses que te mayweather'],
  [news, 'tengo noticias may inglés es que sin macbeth'],
  ['Pero es que yo trate de llamar', 'Traté de llamar'],
  [yesterday, 'No encontraba por ningún sitio además la bola se sentía mal y tuve que volver a buscarla'],
];

test('actor-confirmed manual readings accept continuous and final results in their exact script reply', () => {
  for (const [expected, heard] of confirmed) {
    assert.equal(accepts(expected, heard), true, heard);
    assert.equal(accepts(expected, heard, ''), true, heard);
    assert.equal(normalizeSpeechText(score(expected, heard).referenceText), normalizeSpeechText(heard));
  }
});

test('confirmation never becomes a global alias, an arbitrary suffix, or permission to change a negation', () => {
  for (const [expected, heard] of confirmed) {
    assert.equal(accepts(expected + ' y luego iremos a preparar el teatro', heard), false, expected);
    assert.equal(accepts(expected, 'no nunca ' + heard), false, heard);
    assert.equal(score(expected, heard + ' y luego iremos a preparar el teatro').referenceIndex, 0, heard);
  }
  assert.equal(normalizeSpeechText('sane sour fraile cristales'), 'sane sour fraile cristales');
  assert.equal(accepts('Quiero estar un rato con mis cristales nuevos', 'Solo con mis cristales rotos'), false);
  assert.equal(accepts('Ey, honey', 'Sonny'), false);
});

test('empty captures, generic noises and incomplete long replies still require manual confirmation', () => {
  for (const [expected, heard] of [
    ['Ey, sonny', 'y'], ['Ey, sonny', 'ni'], ['Really?', 'mhm'],
    [news, 'tengo noticias may inglés es que mac'],
    [crystals, 'Solo con mis cristales'],
    [dialects, 'Ya lo sé pero es que son dos idiomas distintos en English y puertorriqueña en English lecciones'],
    ['Me robaron la caja registradora, me rompieron las velas, me robaron todo! Deja de hablar y ponte a trabajar', 'Me robaron la caja registradora me rompieron'],
  ]) assert.equal(accepts(expected, heard), false, heard);
  for (const [expected] of confirmed) assert.equal(accepts(expected, ''), false, expected);
});

test('confirmed replies cannot execute the start or scene voice commands', () => {
  for (const [, heard] of confirmed) {
    assert.equal(isHomeRehearsalCommand(heard), false, heard);
    assert.equal(isSceneAdvanceCommand(heard), false, heard);
  }
});
