const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { getRehearsalResponseTiming: timing } = require('../src/utils/rehearsalResponseTiming.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader; else delete require.extensions['.ts'];

test('response measurements distinguish input closure and voice request/start events from ASR processing', () => {
  const at = Date.parse('2026-11-12T17:00:00.000Z');
  assert.deepEqual(timing(new Date(at).toISOString(), at + 10, at + 20, at + 23, at + 123), {
    kind: 'browser_events', matchToVoiceRequestMs: 23, matchToVoiceStartEventMs: 123,
    inputCloseMs: 10, voiceRequestToStartEventMs: 100,
  });
  assert.equal(timing('invalid date', at, at, at, at), null);
  assert.equal(timing(new Date(at).toISOString(), at, at + 20, at + 10, at + 30), null);
});
