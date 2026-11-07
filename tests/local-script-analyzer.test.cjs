const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Test the same TypeScript parser used by Expo, without a browser or cloud calls.
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { buildScriptDataFromLines: parse } = require('../src/api/localScriptAnalyzer.ts');
const { filterPdfPageLines } = require('../src/utils/pdfTextLines.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader;
else delete require.extensions['.ts'];
const dialogues = (result) => result.guion.filter((line) => line.p !== 'ESCENA_SISTEMA' && line.k !== 'song');
const scenes = (result) => result.guion.filter((line) => line.p === 'ESCENA_SISTEMA').map((line) => line.t);

test('recognizes screenplay character cues on their own lines, including two-word names', () => {
  const result = parse(['LA CARTA', 'ANA', '¿Dónde has dejado la carta?', 'TÍA ROSA', 'En el despacho.', 'ANA', 'Vamos a buscarla.'], 'La carta');
  assert.deepEqual(result.personajes, ['ANA', 'TÍA ROSA']);
  assert.deepEqual(dialogues(result).map((line) => [line.p, line.t]), [
    ['ANA', '¿Dónde has dejado la carta?'], ['TÍA ROSA', 'En el despacho.'], ['ANA', 'Vamos a buscarla.'],
  ]);
});

test('preserves directions attached to the cue and at the beginning of its dialogue', () => {
  const result = parse(['ANA Y LUIS', 'ANA (LE QUITA EL PAPEL A LUIS)', '(en voz baja) Ahora lo leo yo.',
    'LUIS (se aparta)', 'Como quieras.'], 'Audición');
  assert.deepEqual(result.personajes, ['ANA', 'LUIS']);
  assert.equal(dialogues(result)[0].t, 'Ahora lo leo yo.');
  assert.equal(dialogues(result)[0].a, 'LE QUITA EL PAPEL A LUIS | en voz baja');
  assert.equal(dialogues(result)[1].a, 'se aparta');
});

test('cast headings identify scenes; a page break alone keeps the same scene', () => {
  const pages = [
    ['ANA. LUIS Y TÍA ROSA', 'ANA', 'He encontrado la carta.', 'LUIS', '¿Qué pone?', 'TÍA ROSA', 'Espera.'],
    ['ANA', 'Voy a leerla.', 'LUIS', 'Te escuchamos.'],
    ['MARIO Y LUIS', 'MARIO', 'Llegas tarde.', 'LUIS', 'Perdona.'],
  ];
  const result = parse(filterPdfPageLines(pages).map((line) => line.text), 'Audiciones');
  assert.deepEqual(scenes(result), ['ANA. LUIS Y TÍA ROSA', 'MARIO Y LUIS']);
  assert.equal(dialogues(result).length, 7);
  assert.equal(dialogues(result)[3].t, 'Voy a leerla.');
});

test('participant lists are derived from actual cues even if a heading omits a participant', () => {
  const result = parse(['ANA Y LUIS', 'MARIO', 'Os estaba buscando.', 'ANA', 'Aquí estamos.', 'LUIS', 'Pasa.'], 'Audiciones');
  assert.deepEqual(result.personajes, ['ANA', 'LUIS', 'MARIO']);
  assert.deepEqual(scenes(result), ['ANA Y LUIS']);
});

test('abbreviations and shouted dialogue do not become extra characters or songs', () => {
  const result = parse(['ANA Y LUIS', 'ANA', 'Q.H.J', 'LUIS', '¿Qué significa?', 'ANA', 'NO TE VAYAS TODAVÍA', 'LUIS', 'Está bien.'], 'Prueba');
  assert.deepEqual(result.personajes, ['ANA', 'LUIS']);
  assert.equal(dialogues(result)[0].t, 'Q.H.J');
  assert.equal(dialogues(result)[2].t, 'NO TE VAYAS TODAVÍA');
  assert.equal(result.guion.filter((line) => line.k === 'song').length, 0);
});

test('keeps legacy inline dialogue, composite speakers, scene headings and numbered musical cues', () => {
  const result = parse(['ACT 1', 'SCENE 1: LA PLAZA', 'ANA / LUIS: (al unísono) Buenos días.',
    '1) La plaza', 'VAMOS TODOS A LA PLAZA', 'QUE YA EMPIEZA LA FUNCIÓN', 'ANA: Se acabó.'], 'Obra');
  assert.deepEqual(result.personajes, ['ANA', 'LUIS']);
  assert.deepEqual(scenes(result), ['ACT 1 - SCENE 1: LA PLAZA']);
  assert.deepEqual(dialogues(result)[0].r, ['ANA', 'LUIS']);
  assert.equal(dialogues(result)[0].a, 'al unísono');
  assert.equal(result.guion.filter((line) => line.k === 'song').length, 1);
  assert.equal(result.guion.find((line) => line.k === 'song').songTitle, 'La plaza');
});

test('short uppercase lyric lines inside an explicit song are not inferred as characters', () => {
  const result = parse(['ESCENA 1', 'ANA: Escuchad.', '1) El regreso', 'DE NUEVO', 'todo empieza otra vez',
    'DE NUEVO', 'nada va a cambiar', 'LUIS: Volvamos.'], 'Obra');
  assert.deepEqual(result.personajes, ['ANA', 'LUIS']);
  assert.ok(result.guion.some((line) => line.k === 'song'));
});

test('page noise removal preserves repeated edge cues which also occur in the body', () => {
  const pages = [
    ['CABECERA', 'ANA', 'La carta está aquí.', 'LUIS', 'Ya la veo.', 'ANA', 'La abriré.', '1'],
    ['CABECERA', 'ANA', 'No hay firma.', 'LUIS', '¿Qué pone?', 'ANA', 'Una dirección.', '2'],
  ];
  const result = filterPdfPageLines(pages);
  assert.equal(result.filter((line) => line.text === 'ANA').length, 4);
  assert.equal(result.filter((line) => line.text === 'CABECERA').length, 0);
  assert.equal(result.filter((line) => /^\d+$/.test(line.text)).length, 0);
  assert.equal(result.find((line) => line.text === 'No hay firma.').pageNumber, 2);
});

test('an edge line repeated only within a single short page is not a repeated document header', () => {
  const result = filterPdfPageLines([['ANA', 'Hola.', 'ANA'], ['LUIS', 'Adiós.']]);
  assert.equal(result.filter((line) => line.text === 'ANA').length, 2);
});

test('an unrecognized text layout produces an interpretation error rather than claiming the PDF is scanned', () => {
  assert.throws(() => parse(['Una introducción sin nombres de personajes ni réplicas.'], 'Documento'), /He leído el texto/);
});
