const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { scoreLineMatch, getAutomaticLineAdvanceDelay: advanceDelay, getAutomaticLineMatchReason: reason } = require('../src/utils/lineMatching.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

const expected = 'Cada mañana abro la tienda, preparo el café y reviso todos los encargos antes de que mis vecinos salgan hacia el trabajo.';
const delay = (reference, heard, interim = heard, variants = []) => advanceDelay(
  reference, heard, interim, scoreLineMatch(reference, heard, variants)
);

test('a complete final result advances without an additional silence delay', () => {
  assert.equal(delay('Ey, Sonny', 'Ey Sonny', ''), 0);
  assert.equal(delay(expected, expected, ''), 0);
});

test('complete, unique fluent endings can advance before Safari marks the transcript final', () => {
  const heard = 'Siempre preparo un café y reviso los encargos antes de que mis vecinos salgan hacia el trabajo.';
  assert.equal(reason(expected, heard, scoreLineMatch(expected, heard)), 'fluent_final');
  assert.equal(delay(expected, heard), 120);
  const closure = 'Reviso los encargos antes de que mis vecinos salgan hacia el trabajo.';
  assert.equal(reason(expected, closure, scoreLineMatch(expected, closure)), 'replica_closure');
  assert.equal(delay(expected, closure), 120);
});

test('a strong interim match advances promptly without waiting for a final event', () => {
  assert.equal(delay(expected, expected), 60);
  assert.equal(delay('Ey, Sonny', 'Ey Sonny'), 60);
});

test('an unfinished ending or a mid-replica pause cannot use the new interim shortcut', () => {
  const unfinished = 'Reviso los encargos antes de que mis vecinos salgan hacia el';
  assert.equal(reason(expected, unfinished, scoreLineMatch(expected, unfinished)), 'replica_closure');
  assert.equal(delay(expected, unfinished), null);
  assert.equal(delay(expected, 'Cada mañana abro la tienda, preparo el café y reviso todos los encargos'), null);
  assert.equal(delay(expected, 'La puerta está cerrada y tengo mucho sueño'), null);
});

test('a repeated closing phrase or a negation mismatch cannot trigger the new interim shortcut', () => {
  const repeated = 'Reviso los encargos antes de que mis vecinos salgan hacia el trabajo. Cada mañana abro la tienda, preparo el café y reviso todos los encargos antes de que mis vecinos salgan hacia el trabajo.';
  assert.equal(delay(repeated, 'Reviso los encargos antes de que mis vecinos salgan hacia el trabajo.'), null);
  const negated = 'No abro la tienda, preparo el café y reviso todos los encargos antes de que mis vecinos salgan hacia el trabajo.';
  assert.equal(delay(negated, 'Reviso todos los encargos antes de que mis vecinos salgan hacia el trabajo.'), null);
});

test('accepted variants still use their own ending for prompt advancement', () => {
  const variant = 'Cada mañana preparo todo y mis vecinos pasan a comprar antes del trabajo.';
  assert.equal(delay(expected, variant, variant, [variant]), 60);
});
