const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { getAuditionRehearsalPlan: plan, recordAuditionRehearsalProgress: record } = require('../src/utils/auditionRehearsal.ts');
const { filterScriptByScenes } = require('../src/utils/scriptScenes.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];
const { resolveAuditionPreferences } = require('../shared/auditionScenes');

const scene = {
  id: 'audition-example', revision: 1,
  scriptData: { obra: 'Audición', personajes: ['ANA', 'LUIS', 'BEA'], guion: [
    { p: 'ESCENA_SISTEMA', t: 'PRIMERA' },
    { p: 'ANA', t: '¿Vienes conmigo?' },
    { p: 'LUIS', t: 'Ahora voy.' },
    { p: 'ESCENA_SISTEMA', t: 'SEGUNDA' },
    { p: 'BEA', t: '¿Dónde están?' },
    { p: 'ESCENA_SISTEMA', t: 'FINAL' },
    { p: 'ANA / BEA', r: ['ANA', 'BEA'], t: '¡Aquí!' },
  ] },
};
const preferences = () => ({ roles: ['ANA'], revision: 1, lineIndex: 4 });

test('my scenes uses actual participation, includes shared cues, and keeps the other actors in those scenes', () => {
  const mine = plan(scene, preferences(), 'MINE');
  assert.deepEqual(mine.sceneFilter, ['PRIMERA', 'FINAL']);
  assert.equal(mine.lineCount, 5);
  const filtered = filterScriptByScenes(scene.scriptData.guion, mine.sceneFilter);
  assert.ok(filtered.some((line) => line.p === 'LUIS'));
  assert.ok(!filtered.some((line) => line.t === '¿Dónde están?'));
  assert.equal(mine.lineIndex, 0);
});

test('all scenes retains legacy progress and includes the entire mini-script', () => {
  const all = plan(scene, preferences(), 'ALL');
  assert.deepEqual(all.sceneFilter, ['PRIMERA', 'SEGUNDA', 'FINAL']);
  assert.equal(all.lineCount, 7);
  assert.equal(all.lineIndex, 4);
  assert.equal(all.canResume, true);
});

test('selecting multiple characters includes each matching scene once in script order', () => {
  assert.deepEqual(plan(scene, { ...preferences(), roles: ['BEA', 'ANA'] }, 'MINE').sceneFilter, ['PRIMERA', 'SEGUNDA', 'FINAL']);
  assert.equal(plan(scene, { ...preferences(), roles: [] }, 'MINE').lineCount, 0);
});

test('all and my scenes have independent progress across a reload', () => {
  const mine = plan(scene, preferences(), 'MINE');
  const stored = record(preferences(), 'MINE', mine.sceneFilter, ['ANA'], 3);
  const reloaded = resolveAuditionPreferences(scene, JSON.parse(JSON.stringify(stored)));
  assert.equal(plan(scene, reloaded, 'MINE').lineIndex, 3);
  assert.equal(plan(scene, reloaded, 'ALL').lineIndex, 4);
  const later = record(reloaded, 'ALL', plan(scene, reloaded, 'ALL').sceneFilter, ['ANA'], 2);
  assert.equal(plan(scene, later, 'MINE').lineIndex, 3);
  assert.equal(plan(scene, later, 'ALL').lineIndex, 2);
});

test('changing characters invalidates my-scene progress even if the matching scene list stays the same', () => {
  const stored = record(preferences(), 'MINE', ['PRIMERA', 'FINAL'], ['ANA'], 3);
  assert.equal(plan(scene, { ...stored, roles: ['ANA', 'LUIS'] }, 'MINE').lineIndex, 0);
  assert.equal(plan(scene, { ...stored, roles: ['BEA'] }, 'MINE').lineIndex, 0);
  assert.equal(plan(scene, stored, 'ALL').lineIndex, 4);
});

test('a changed scene filter, invalid stored checkpoint, or text revision cannot resume at an unrelated line', () => {
  const stored = record(preferences(), 'MINE', ['PRIMERA'], ['ANA'], 2);
  assert.equal(plan(scene, stored, 'MINE').lineIndex, 0);
  const invalid = resolveAuditionPreferences(scene, { ...stored, mineCheckpoint: { roles: ['ANA'], sceneFilter: ['MISSING'], lineIndex: 2 } });
  assert.equal(invalid.mineCheckpoint, undefined);
  const revised = { ...scene, revision: 2 };
  const reset = resolveAuditionPreferences(revised, record(preferences(), 'MINE', ['PRIMERA', 'FINAL'], ['ANA'], 3));
  assert.equal(plan(revised, reset, 'MINE').lineIndex, 0);
  assert.equal(plan(revised, reset, 'ALL').lineIndex, 0);
  assert.deepEqual(reset.roles, ['ANA']);
});

test('completed my-scene rehearsals restart, and unchanged progress does not schedule repeated state writes', () => {
  const stored = record(preferences(), 'MINE', ['PRIMERA', 'FINAL'], ['ANA'], 5);
  assert.equal(plan(scene, stored, 'MINE').canResume, false);
  assert.strictEqual(record(stored, 'MINE', ['PRIMERA', 'FINAL'], ['ANA'], 5), stored);
  assert.strictEqual(record(stored, 'ALL', ['PRIMERA', 'SEGUNDA', 'FINAL'], ['ANA'], 4), stored);
});
