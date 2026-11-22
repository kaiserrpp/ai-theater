const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const loader = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const {
  getNumberAudios, getNumberBlocks, getNumberCharacters, getNumberHarmonyChoices, getNumberKaraoke,
  getNumberLyrics, getNumberRoles, getNumberTimingIssue, getNumberVocalGuides, getReferenceAudio, numberKaraokeKey,
} = require('../src/utils/musicalNumberPractice.ts');
const { getScenesForRolesAndSongs } = require('../src/utils/scriptScenes.ts');
if (loader) require.extensions['.ts'] = loader; else delete require.extensions['.ts'];

const cast = ['ANA', 'LUIS', 'MARTA'];
const audio = (id, options = {}) => ({
  id, label: id, kind: 'vocal_guide', guideRoles: [], audioUrl: 'https://example.test/' + id,
  timelineCues: [], ...options,
});
const ana = audio('Ana', { guideRoles: ['ANA'], audibleRoles: ['ANA'] });
const luis = audio('Luis', { guideRoles: ['LUIS'], audibleRoles: ['LUIS'] });
const marta = audio('Marta', { guideRoles: ['MARTA'], audibleRoles: ['MARTA'] });
const others = audio('Luis and Marta', { audibleRoles: ['LUIS', 'MARTA'] });
const instrumental = audio('Band', { kind: 'karaoke', audibleRoles: [] });
const bass = audio('Bass harmony', { choirPart: 'bass' });
const number = (options = {}) => ({
  id: 'number-one', title: 'El número', sceneTitle: 'La plaza',
  startLineIndex: 1, endLineIndex: 6, songIds: ['song-one', 'song-two'], audios: [ana, luis, marta, bass],
  ...options,
});
const guion = [
  { p: 'ESCENA_SISTEMA', t: 'La plaza' },
  { p: 'CANCION_SISTEMA', t: 'Primera estrofa' },
  { p: 'LUIS', t: 'Qué sorpresa' },
  { p: 'ANA', t: 'Buenos días' },
  { p: 'CANCION_SISTEMA', t: 'Segunda estrofa' },
  { p: 'MARTA', t: 'Hasta mañana' },
  { p: 'LUIS', t: 'Nos vemos' },
  { p: 'ESCENA_SISTEMA', t: 'La casa' },
  { p: 'ANA', t: 'Ya llegué' },
];

test('one number unifies its own and linked recordings, with a reference and a single text', () => {
  const original = audio('Original reference');
  const linkedKaraoke = { ...instrumental, id: 'linked-instrumental' };
  const songs = [
    { id: 'song-one', lyrics: 'Primera', audios: [original, linkedKaraoke] },
    { id: 'song-two', lyrics: 'Segunda', audios: [] },
  ];
  const item = number({ audios: [original, bass] });
  const combined = getNumberAudios(item, songs);
  assert.deepEqual(combined, [original, bass, linkedKaraoke]);
  assert.equal(getReferenceAudio(item, combined), original);
  assert.equal(getReferenceAudio({ ...item, referenceAudioId: bass.id }, combined), bass);
  assert.equal(getNumberLyrics(item, songs), 'Primera\n\nSegunda');
  assert.equal(getNumberLyrics({ ...item, lyrics: 'Número completo' }, songs), 'Número completo');
});

test('the same recording can teach its assigned actor and accompany a different actor who is absent from its voices', () => {
  const mixedWithAna = audio('Mixed', { guideRoles: ['LUIS'], audibleRoles: ['ANA', 'LUIS'] });
  const unknown = audio('Unclassified', { guideRoles: ['MARTA'], audibleRoles: null });
  const tracks = [ana, luis, marta, mixedWithAna, unknown, bass, instrumental];
  assert.deepEqual(getNumberVocalGuides(tracks, 'luis'), [luis, mixedWithAna]);
  assert.deepEqual(getNumberKaraoke(tracks, cast, 'Ana').options, [luis, marta, instrumental]);
  assert.deepEqual(getNumberKaraoke(tracks, cast, 'Luis').options, [ana, marta, instrumental]);
  assert.deepEqual(getNumberKaraoke(tracks, cast, 'ENRIQUE').options, []);
});

test('a remembered partial survives added partials and a complete accompaniment is promoted', () => {
  const partials = [luis, marta, instrumental];
  assert.equal(getNumberKaraoke(partials, cast, 'ANA').preferred, undefined);
  assert.equal(getNumberKaraoke(partials, cast, 'ANA', marta.id).preferred, marta);
  assert.equal(getNumberKaraoke([audio('Otro Luis', { audibleRoles: ['LUIS'] }), ...partials], cast, 'ANA', marta.id).preferred, marta);
  const result = getNumberKaraoke([...partials, others], cast, 'ANA', marta.id);
  assert.equal(result.preferred, others);
  assert.deepEqual(result.options, [others, luis, marta, instrumental]);
  assert.equal(getNumberKaraoke([instrumental], ['ANA'], 'ANA').preferred, instrumental);
  assert.notEqual(numberKaraokeKey('number-one', 'Ana'), numberKaraokeKey('number-one', 'Luis'));
  assert.equal(numberKaraokeKey('number-one', ' Ana '), numberKaraokeKey('number-one', 'ANA'));
});

test('work role order selects the default character, while harmony is available independently of the cast', () => {
  assert.deepEqual(getNumberCharacters(cast, ['MARTA', 'LUIS', 'ENRIQUE']), ['MARTA', 'LUIS']);
  assert.deepEqual(getNumberCharacters(['ANA', 'MARTA'], ['LUIS']), []);
  assert.deepEqual(getNumberHarmonyChoices([bass, ana], 'bass-1'), [bass]);
  assert.deepEqual(getNumberHarmonyChoices([bass, audio('Bass 2', { choirPart: 'bass-2' })], 'bass-1'), [bass]);
  assert.deepEqual(getNumberRoles(number({ roles: [] })), []);
  assert.deepEqual(getScenesForRolesAndSongs(guion, ['SOLISTA'], [], [number({ roles: ['SOLISTA'] })]), ['La plaza']);
});

test('timed rehearsal uses only the linked script range and requires current entries for each change of block', () => {
  const blocks = getNumberBlocks(number(), guion);
  assert.deepEqual(blocks.map(({ kind, startLineIndex, endLineIndex }) => [kind, startLineIndex, endLineIndex]),
    [['song', 1, 1], ['dialogue', 2, 3], ['song', 4, 4], ['dialogue', 5, 6]]);
  assert.deepEqual(getNumberBlocks(number({ endLineIndex: 8 }), guion), []);
  const marked = { ...instrumental, timelineCues: [
    { id: 'dialogue1', atMs: 1550, targetLineIndex: 2, targetKind: 'dialogue' },
    { id: 'song2', atMs: 8400, targetLineIndex: 4, targetKind: 'song' },
    { id: 'dialogue2', atMs: 15400, targetLineIndex: 5, targetKind: 'dialogue' },
  ] };
  assert.equal(getNumberTimingIssue(blocks, marked), null);
  assert.match(getNumberTimingIssue(blocks, { ...marked, timelineNeedsReview: true }), /Revisa/);
  assert.match(getNumberTimingIssue(blocks, { ...marked, timelineCues: marked.timelineCues.slice(1) }), /Marca/);
  assert.match(getNumberTimingIssue(blocks, { ...marked, timelineCues: marked.timelineCues.map((cue) => ({ ...cue, atMs: 2700 })) }), /Marca/);
});
