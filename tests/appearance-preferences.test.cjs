const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { paletteForBackground, contrastRatio, parseBackgroundPreference, averageFromBlurhash, defaultPalette, imageAccentFromPixels } = require('../src/utils/appearance.ts');
const { parsePreferredWork, resolveStartupWork } = require('../src/utils/preferredWork.ts');
const { createWorkAppearanceStore, appearanceWorkKey } = require('../src/store/workAppearances.ts');
const { BACKGROUND_STORAGE_KEY, WORK_APPEARANCES_STORAGE_KEY } = require('../src/store/storageKeys.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];

const rgb = (hex) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));

test('light, dark and saturated photographs retain readable text, labels, selections and buttons', () => {
  for (const red of [0, 51, 102, 153, 204, 255]) for (const green of [0, 51, 102, 153, 204, 255]) for (const blue of [0, 51, 102, 153, 204, 255]) {
    const palette = paletteForBackground([red, green, blue]);
    const dark = palette.isDark;
    // Worst possible crop: an entirely white patch under a dark scrim, or black under a light scrim.
    const opacity = Number(palette.overlay.match(/,([\d.]+)\)$/)[1]);
    const worstChannel = Math.round(255 * (dark ? 1 - opacity : opacity));
    const overlayBackground = [worstChannel, worstChannel, worstChannel];
    for (const background of [overlayBackground, rgb(palette.bg), rgb(palette.surface), rgb(palette.soft), rgb(palette.chip)]) {
      for (const text of ['ink', 'sub', 'plum', 'error', 'green']) {
        assert.ok(contrastRatio(rgb(palette[text]), background) >= 4.5, `${[red, green, blue]} ${text} on ${background}`);
      }
    }
    assert.ok(contrastRatio(rgb(palette.onButton), rgb(palette.button)) >= 4.5);
  }
});

test('removing the background restores the original palette exactly', () => {
  assert.deepEqual(paletteForBackground(null), defaultPalette);
  assert.equal(paletteForBackground([255, 255, 255]).isDark, false);
  assert.equal(paletteForBackground([0, 0, 0]).isDark, true);
});

test('the photograph is more visible and its hue determines menus, surfaces, text and buttons', () => {
  const red = paletteForBackground([100, 20, 15]);
  const blue = paletteForBackground([15, 30, 100]);
  assert.ok(Number(red.overlay.match(/,([\d.]+)\)$/)[1]) <= 0.60);
  assert.ok(Number(paletteForBackground([240, 230, 220]).overlay.match(/,([\d.]+)\)$/)[1]) <= 0.68);
  for (const key of ['bg', 'surface', 'soft', 'ink', 'sub', 'plum', 'button']) assert.notEqual(red[key], blue[key], key);
  assert.ok(rgb(red.surface)[0] > rgb(red.surface)[2]);
  assert.ok(rgb(blue.surface)[2] > rgb(blue.surface)[0]);
});

test('poster margins and lettering do not hide a prominent source color', () => {
  const pixels = new Uint8ClampedArray([...Array(50).fill([255, 255, 255, 255]).flat(), ...Array(50).fill([0, 0, 0, 255]).flat(), ...Array(10).fill([30, 150, 210, 255]).flat()]);
  assert.deepEqual(imageAccentFromPixels(pixels, [127, 127, 127]), [30, 150, 210]);
  assert.deepEqual(imageAccentFromPixels(new Uint8ClampedArray([255, 255, 255, 255]), [255, 255, 255]), [255, 255, 255]);
  const background = { uri: 'data:image/jpeg;base64,AA==', name: 'poster.jpg', average: [120, 120, 120], accent: [30, 150, 210] };
  assert.deepEqual(parseBackgroundPreference(JSON.stringify(background)), background);
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

const poster = (name, average = [100, 20, 15]) => ({ uri: `data:image/jpeg;base64,${name}`, name, average });
const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  let failWrites = false;
  return {
    data,
    failWrites: (value) => { failWrites = value; },
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => { if (failWrites) throw new Error('quota'); data.set(key, value); },
    removeItem: async (key) => { data.delete(key); },
  };
};

test('each work restores its own image and palette across switching and a fresh launch', async () => {
  const storage = memoryStorage();
  const store = createWorkAppearanceStore(storage, 'shared:a');
  const a = poster('a'), b = poster('b', [15, 30, 100]);
  await store.load();
  await store.save('shared:a', a);
  await store.save('shared:b', b);
  assert.deepEqual(await store.load(), { 'shared:a': a, 'shared:b': b });
  const restored = await createWorkAppearanceStore(storage, 'shared:b').load();
  assert.deepEqual(restored['shared:a'], a);
  assert.deepEqual(restored['shared:b'], b);
  assert.notDeepEqual(paletteForBackground(restored['shared:a'].average), paletteForBackground(restored['shared:b'].average));
  assert.equal(restored['shared:new'], undefined);
  const reset = await store.save('shared:a', null);
  assert.equal(reset.works['shared:a'], null);
  assert.deepEqual(reset.works['shared:b'], b);
  assert.equal(reset.orphanedUri, a.uri);
  const reopened = await createWorkAppearanceStore(storage, 'shared:a').load();
  assert.equal(reopened['shared:a'], null);
  assert.deepEqual(reopened['shared:b'], b);
});

test('the old global background migrates to the remembered work even when a different shared link opens', async () => {
  const previous = poster('previous');
  const storage = memoryStorage({ [BACKGROUND_STORAGE_KEY]: JSON.stringify(previous) });
  const works = await createWorkAppearanceStore(storage, appearanceWorkKey({ kind: 'shared', id: 'remembered' })).load();
  assert.deepEqual(works['shared:remembered'], previous);
  assert.equal(works['shared:linked'], undefined);
  assert.equal(storage.data.has(BACKGROUND_STORAGE_KEY), false);
  const existing = memoryStorage({ [BACKGROUND_STORAGE_KEY]: JSON.stringify(previous),
    [WORK_APPEARANCES_STORAGE_KEY]: JSON.stringify({ version: 1, works: { 'shared:remembered': null, 'shared:other': poster('other') } }) });
  const kept = await createWorkAppearanceStore(existing, 'shared:remembered').load();
  assert.equal(kept['shared:remembered'], null);
  assert.deepEqual(kept['shared:other'], poster('other'));
});

test('failed migration retains the old background and can be retried', async () => {
  const previous = poster('previous');
  const storage = memoryStorage({ [BACKGROUND_STORAGE_KEY]: JSON.stringify(previous) });
  const store = createWorkAppearanceStore(storage, 'local:a');
  storage.failWrites(true);
  await assert.rejects(store.load(), /quota/);
  assert.equal(storage.data.has(BACKGROUND_STORAGE_KEY), true);
  storage.failWrites(false);
  assert.deepEqual((await store.load())['local:a'], previous);
});

test('overlapping saves stay assigned to their original works and cannot overwrite another work', async () => {
  const storage = memoryStorage();
  const store = createWorkAppearanceStore(storage, 'shared:a');
  const [a, b] = [poster('a'), poster('b')];
  await Promise.all([store.save('shared:a', a), store.save('shared:b', b)]);
  assert.deepEqual(await createWorkAppearanceStore(storage, 'shared:a').load(), { 'shared:a': a, 'shared:b': b });
  const sharedImage = await store.save('shared:b', a);
  assert.equal(sharedImage.orphanedUri, b.uri);
  assert.equal((await store.save('shared:a', null)).orphanedUri, null);
  storage.failWrites(true);
  await assert.rejects(store.save('shared:b', poster('failed')), /quota/);
  storage.failWrites(false);
  await store.save('shared:c', poster('c'));
  assert.deepEqual((await createWorkAppearanceStore(storage, 'shared:b').load())['shared:b'], a);
  assert.notEqual(appearanceWorkKey({ kind: 'local', id: 'same' }), appearanceWorkKey({ kind: 'shared', id: 'same' }));
});
