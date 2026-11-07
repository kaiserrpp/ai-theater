const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { resolveListenPreference, resolveTranscriptPreference } = require('../src/utils/rehearsalPreferences.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

test('new and legacy pending preferences choose intelligent only when recognition is supported', () => {
  for (const stored of [null, 'pending', 'unknown', 'intelligent']) {
    assert.equal(resolveListenPreference(stored, true), 'intelligent');
    assert.equal(resolveListenPreference(stored, false), 'manual');
  }
});
test('a deliberate manual or silence selection survives reopening the app', () => {
  for (const supported of [true, false]) {
    assert.equal(resolveListenPreference('manual', supported), 'manual');
    assert.equal(resolveListenPreference('auto', supported), 'auto');
  }
});
test('the transcript is visible on a new installation and upgrade, with only an explicit false opting out', () => {
  for (const stored of [null, 'true', '', 'unknown']) assert.equal(resolveTranscriptPreference(stored), true);
  assert.equal(resolveTranscriptPreference('false'), false);
});
