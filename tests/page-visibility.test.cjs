const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { observePageVisibility, isPageVisible } = require('../src/utils/pageVisibility.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

test('visibility and back/forward-cache transitions suspend a page, while permission-dialog blur does not', (t) => {
  const previousDocument = global.document;
  const previousWindow = global.window;
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = new EventTarget();
  global.document = document; global.window = window;
  t.after(() => { global.document = previousDocument; global.window = previousWindow; });
  const changes = [];
  const dispose = observePageVisibility((visible) => changes.push(visible));
  window.dispatchEvent(new Event('blur'));
  window.dispatchEvent(new Event('focus'));
  assert.deepEqual(changes, [true]);
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(isPageVisible(), false);
  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('pagehide'));
  window.dispatchEvent(new Event('pageshow'));
  assert.deepEqual(changes, [true, false, true, false, true]);
  dispose();
  document.visibilityState = 'hidden';
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('pageshow'));
  assert.equal(changes.length, 5);
});

test('native foreground state suspends a WebView even if its document is still visible', t => {
  const previousDocument = global.document, previousWindow = global.window;
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const window = Object.assign(new EventTarget(), { __AI_THEATRE_NATIVE_V1__: {
    protocol: 1, platform: 'ios', appVersion: '2026.11.224', foreground: true,
  } });
  global.document = document; global.window = window;
  t.after(() => { global.document = previousDocument; global.window = previousWindow; });
  const changes = [], dispose = observePageVisibility(value => changes.push(value));
  window.__AI_THEATRE_NATIVE_V1__.foreground = false;
  window.dispatchEvent(new Event('ai-theatre-native-visibility'));
  assert.equal(isPageVisible(), false);
  window.__AI_THEATRE_NATIVE_V1__.foreground = true;
  window.dispatchEvent(new Event('ai-theatre-native-visibility'));
  document.visibilityState = 'hidden';
  window.dispatchEvent(new Event('ai-theatre-native-visibility'));
  assert.deepEqual(changes, [true, false, true, false]);
  dispose();
  window.dispatchEvent(new Event('ai-theatre-native-visibility'));
  assert.equal(changes.length, 4);
});
