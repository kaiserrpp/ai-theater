const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const previous = require.extensions['.ts'];
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { createSpeechRecognitionSession } = require('../src/utils/speechRecognitionSession.ts');
if (previous) require.extensions['.ts'] = previous; else delete require.extensions['.ts'];
const { normalizeRecognitionSessionDiagnostics } = require('../shared/recognitionDiagnostics');
const result = text => ({ isFinal: true, 0: { transcript: text } });
const fixture = t => {
  const handles = []; let now = 1000;
  class Recognition { constructor() { handles.push(this); } start() {} abort() {} }
  const session = createSpeechRecognitionSession(Recognition, () => {}, { now: () => now });
  t.after(() => session.dispose());
  const configure = (extra = {}) => session.configure({ enabled: true, lang: 'es-ES', lineKey: 'one', ...extra });
  return { session, handles, configure, tick: ms => { now += ms; } };
};

test('recognition diagnostics distinguish service start, input start and first words without treating an open microphone as speech', t => {
  const f = fixture(t); f.configure();
  f.tick(10); f.handles[0].onstart();
  assert.equal(f.session.getDiagnostics().firstAudioStartMs, null);
  f.tick(20); f.handles[0].onaudiostart();
  const open = f.session.getDiagnostics(); assert.equal(open.firstServiceStartMs, 10); assert.equal(open.firstAudioStartMs, 30);
  assert.equal(open.firstTextMs, null); assert.equal(open.currentTranscriptEmpty, true);
  f.tick(250); f.handles[0].onresult({ results: [result('Texto recibido')] });
  const text = f.session.getDiagnostics(); assert.equal(text.firstTextMs, 280); assert.equal(text.textEventCount, 1);
  assert.equal(text.currentTranscriptEmpty, false); assert.equal(text.startCount, 1);
  f.tick(1000); assert.equal(f.session.getDiagnostics().elapsedMs, 1280);
});

test('an explicit retry preserves the failed attempt diagnostic and starts with clean words', t => {
  const f = fixture(t); f.configure(); f.tick(25); f.handles[0].onerror({ error: 'network', message: 'private URL must not be recorded' });
  const failed = f.session.getDiagnostics(); assert.equal(failed.status, 'error'); assert.equal(failed.firstTextMs, null);
  assert.deepEqual(failed.errors, [{ code: 'network', atMs: 25 }]);
  f.tick(100); f.session.restart(); f.handles[1].onaudiostart(); f.handles[1].onresult({ results: [result('Frase nueva')] });
  const retried = f.session.getDiagnostics(); assert.equal(retried.retryCount, 1); assert.equal(retried.startCount, 2);
  assert.equal(retried.firstTextMs, 125); assert.equal(retried.errors[0].code, 'network');
  assert.equal(f.session.getSnapshot().transcript, 'Frase nueva');
  assert.equal(JSON.stringify(retried).includes('private URL'), false);
});

test('no-speech events stay informational and a reused live input is identified without fabricated start events', t => {
  const f = fixture(t); f.configure(); f.handles[0].onaudiostart();
  f.handles[0].onerror({ error: 'no-speech' }); assert.equal(f.session.getDiagnostics().noSpeechCount, 1);
  assert.equal(f.session.getSnapshot().error, null);
  f.handles[0].onresult({ results: [result('Primera')] }); f.tick(10); f.configure({ lineKey: 'two' });
  const warm = f.session.getDiagnostics(); assert.equal(warm.startCount, 0); assert.equal(warm.inputAlreadyActive, true);
  assert.equal(warm.firstAudioStartMs, null); assert.equal(warm.firstTextMs, null);
  f.tick(40); f.handles[0].onresult({ results: [result('Primera'), result('Segunda')] });
  assert.equal(f.session.getDiagnostics().firstTextMs, 40); assert.equal(f.session.getSnapshot().transcript, 'Segunda');
});

test('pause/resume retains words and diagnostic history while stale callbacks cannot add evidence', t => {
  const f = fixture(t); f.configure(); f.handles[0].onaudiostart();
  f.tick(10); f.handles[0].onresult({ results: [result('Primera parte')] });
  const stale = f.handles[0].onresult; f.configure({ enabled: false }); f.tick(14000);
  f.session.activate({ lang: 'es-ES', lineKey: 'one', preserveTranscript: true }); f.configure();
  stale({ results: [result('No debe aparecer')] }); f.handles[1].onresult({ results: [result('y el final')] });
  assert.equal(f.session.getSnapshot().transcript, 'Primera parte y el final');
  assert.equal(f.session.getDiagnostics().firstTextMs, 10); assert.equal(f.session.getDiagnostics().textEventCount, 2);
  assert.equal(f.session.getDiagnostics().retryCount, 0);
});

test('server diagnostics are bounded, allowlisted and never retain audio, hint words or arbitrary error payloads', () => {
  const normalized = normalizeRecognitionSessionDiagnostics({ kind: 'recognition_session', status: 'listening', elapsedMs: Infinity,
    firstTextMs: NaN, startCount: 1e10, retryCount: -1, audio: 'PRIVATE_AUDIO', text: 'PRIVATE_TEXT',
    errors: Array.from({ length: 12 }, (_, index) => ({ code: 'network', atMs: index, message: 'PRIVATE_MESSAGE' })) });
  assert.equal(normalized.startCount, 100000); assert.equal(normalized.retryCount, 0); assert.equal(normalized.elapsedMs, 0);
  assert.equal(normalized.firstTextMs, null); assert.equal(normalized.errors.length, 8);
  assert.equal(JSON.stringify(normalized).includes('PRIVATE_'), false);
  assert.equal(normalizeRecognitionSessionDiagnostics({ kind: 'recognition_session', status: '<script>' }), null);
});
