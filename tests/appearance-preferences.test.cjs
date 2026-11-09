const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { paletteForBackground, contrastRatio, parseBackgroundPreference, averageFromBlurhash, defaultPalette } = require('../src/utils/appearance.ts');
const { parsePreferredWork, resolveStartupWork } = require('../src/utils/preferredWork.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

const rgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));

test('light, dark and saturated photographs retain readable text, labels, selections and buttons', () => {
  for (const red of [0, 51, 102, 153, 204, 255]) for (const green of [0, 51, 102, 153, 204, 255]) for (const blue of [0, 51, 102, 153, 204, 255]) {
    const palette = paletteForBackground([red, green, blue]);
    const dark = palette.ink === '#ffffff';
    // Worst possible crop: an entirely white patch under a dark scrim, or black under a light scrim.
    const overlayBackground = dark ? [56, 56, 56] : [209, 209, 209];
    for (const background of [overlayBackground, rgb(palette.surface), rgb(palette.soft), rgb(palette.chip)]) {
      for (const text of ['ink', 'sub', 'plum', 'error', 'green']) {
        assert.ok(contrastRatio(rgb(palette[text]), background) >= 4.5, `${[red, green, blue]} ${text} on ${background}`);
      }
    }
    assert.ok(contrastRatio(rgb(palette.onButton), rgb(palette.button)) >= 4.5);
  }
});

test('removing the background restores the original palette exactly', () => {
  assert.deepEqual(paletteForBackground(null), defaultPalette);
  assert.equal(paletteForBackground([255, 255, 255]).ink, '#20232c');
  assert.equal(paletteForBackground([0, 0, 0]).ink, '#ffffff');
});

test('background preferences survive serialization and reject damaged or remote values', () => {
  const preference = { uri: 'data:image/jpeg;base64,AA==', name: 'Cartel.jpg', average: [30, 90, 150] };
  assert.deepEqual(parseBackgroundPreference(JSON.stringify(preference)), preference);
  assert.deepEqual(parseBackgroundPreference(JSON.stringify({ ...preference, uri: 'file:///documents/theatre-background-1.jpg' })).average, preference.average);
  for (const value of [null, '', '{', 'null', '{}', JSON.stringify({ ...preference, average: [300, 0, 0] }),
    JSON.stringify({ ...preference, average: [0, '1', 0] }), JSON.stringify({ ...preference, uri: 'https://example.com/background.jpg' }),
    JSON.stringify({ ...preference, uri: 'blob:temporary' })]) assert.equal(parseBackgroundPreference(value), null);
});

test('the native image analysis decodes the BlurHash DC color', () => {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~';
  for (const color of [[0, 0, 0], [255, 255, 255], [75, 12, 190]]) {
    let value = color[0] * 65536 + color[1] * 256 + color[2];
    let dc = '';
    for (let index = 0; index < 4; index++) { dc = alphabet[value % 83] + dc; value = Math.floor(value / 83); }
    assert.deepEqual(averageFromBlurhash(`00${dc}`), color);
  }
  assert.throws(() => averageFromBlurhash('bad'));
});

test('a remembered local or shared work survives a fresh launch and can be replaced by another choice', () => {
  let stored = JSON.stringify({ kind: 'local', id: 'script-a' });
  assert.deepEqual(resolveStartupWork(null, parsePreferredWork(stored)), { kind: 'local', id: 'script-a' });
  stored = JSON.stringify({ kind: 'shared', id: 'work-b' });
  assert.deepEqual(resolveStartupWork(null, parsePreferredWork(stored)), { kind: 'shared', id: 'work-b' });
});

test('an explicit shared link takes precedence over the remembered work, including a local one', () => {
  for (const preferred of [null, { kind: 'shared', id: 'old' }, { kind: 'local', id: 'local' }]) {
    assert.deepEqual(resolveStartupWork('linked-work', preferred), { kind: 'shared', id: 'linked-work' });
  }
  assert.equal(resolveStartupWork(null, null), null);
  for (const stored of [null, '', 'null', '{}', '{', '{"kind":"shared","id":""}', '{"kind":"other","id":"a"}']) assert.equal(parsePreferredWork(stored), null);
});
