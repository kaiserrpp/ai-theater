const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const old = require.extensions['.ts'];
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { createFeedbackOutbox } = require('../src/utils/feedbackOutbox.ts');
const { isHomeRehearsalCommand } = require('../src/utils/voiceAdvance.ts');
if (old) require.extensions['.ts'] = old; else delete require.extensions['.ts'];
const report = (id = 'completed-one', entries = []) => ({ sessionId: id, scriptId: 'script', shareId: 'work', scriptTitle: 'Play',
  appVersion: 'test', userRoles: ['ANA'], entries, completedRehearsal: { lineCount: 12, listenMode: 'intelligent', elapsedMs: 34000 } });
const fixture = (initial = null) => {
  let stored = initial, writable = true, scope = 'production', fail = false;
  const sent = [];
  const deps = { read: async () => stored, write: async value => { stored = value; }, scope: () => scope,
    writable: async () => writable, send: async value => { if (fail) throw new Error('offline'); sent.push(value); } };
  return { deps, sent, stored: () => stored, setWritable: v => { writable = v; }, setScope: v => { scope = v; }, setFail: v => { fail = v; } };
};
test('completion is durable before leaving and a restored outbox sends and acknowledges exactly that report', async () => {
  const f = fixture(), first = createFeedbackOutbox(f.deps);
  await first.enqueue(report());
  assert.equal(JSON.parse(f.stored())[0].report.completedRehearsal.lineCount, 12);
  assert.equal(first.getSnapshot().pending, 1);
  const restored = createFeedbackOutbox(f.deps); await restored.flush();
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].sessionId, 'completed-one');
  assert.deepEqual(JSON.parse(f.stored()), []); assert.equal(restored.getSnapshot().pending, 0);
});
test('protected storage never receives a POST and the same report sends once after storage is enabled', async () => {
  const f = fixture(), box = createFeedbackOutbox(f.deps); f.setWritable(false);
  await box.enqueue(report()); await box.flush(); await box.flush();
  assert.equal(f.sent.length, 0); assert.equal(box.getSnapshot().pending, 1);
  assert.match(box.getSnapshot().message, /protegido/);
  f.setWritable(true); await box.flush(); await box.flush(); assert.equal(f.sent.length, 1);
});
test('a failed upload preserves the exact session ID and every entry across reload and retry', async () => {
  const f = fixture(), box = createFeedbackOutbox(f.deps); f.setFail(true);
  const original = report('stable', [{ heardText: 'raw transcript', result: 'siguiente_linea' }]);
  await box.enqueue(original); await box.flush();
  assert.equal(box.getSnapshot().pending, 1); assert.deepEqual(JSON.parse(f.stored())[0].report, original);
  f.setFail(false); await createFeedbackOutbox(f.deps).flush(); assert.deepEqual(f.sent, [original]);
});
test('a long rehearsal splits into bounded batches without truncating lines or erasing older pending reports', async () => {
  const f = fixture(), box = createFeedbackOutbox(f.deps);
  await box.enqueue(report('earlier'));
  await box.enqueue(report('long', Array.from({ length: 1102 }, (_, index) => ({ index }))));
  await box.flush(); assert.equal(f.sent.length, 4);
  assert.deepEqual(f.sent.slice(1).map(r => r.entries.length), [500, 500, 102]);
  assert.deepEqual(f.sent.slice(1).flatMap(r => r.entries).map(e => e.index), Array.from({ length: 1102 }, (_, index) => index));
});
test('production and preview queues never send to each other', async () => {
  const f = fixture(), box = createFeedbackOutbox(f.deps);
  await box.enqueue(report('production')); f.setScope('preview'); await box.enqueue(report('preview'));
  await box.flush(); assert.deepEqual(f.sent.map(r => r.sessionId), ['preview']);
  assert.equal(JSON.parse(f.stored())[0].report.sessionId, 'production');
  f.setScope('production'); await box.flush(); assert.deepEqual(f.sent.map(r => r.sessionId), ['preview', 'production']);
});
test('concurrent completion, retry and a newly completed session cannot duplicate or lose reports', async () => {
  const f = fixture(); let acknowledge;
  f.deps.send = async value => { f.sent.push(value); if (value.sessionId === 'one') await new Promise(resolve => { acknowledge = resolve; }); };
  const box = createFeedbackOutbox(f.deps); await box.enqueue(report('one'));
  const first = box.flush(); assert.equal(box.flush(), first);
  await new Promise(resolve => setImmediate(resolve));
  await box.enqueue(report('two')); acknowledge(); await first;
  assert.equal(box.getSnapshot().pending, 1); await box.flush();
  assert.deepEqual(f.sent.map(r => r.sessionId), ['one', 'two']);
});
test('a failed local save cannot falsely acknowledge completion or erase previously saved reports', async () => {
  const f = fixture(), box = createFeedbackOutbox({ ...f.deps, write: async () => { throw new Error('storage full'); } });
  await assert.rejects(box.enqueue(report()), /storage full/); assert.equal(f.stored(), null); assert.equal(f.sent.length, 0);
});
test('home accepts only the complete command ensayo, with no conversation or negations', () => {
  for (const value of ['ensayo', '¡Ensayo!', ' ENSAYO ']) assert.equal(isHomeRehearsalCommand(value), true);
  for (const value of ['', 'no ensayo', 'empezar ensayo', 'estamos en un ensayo', 'adelante', 'siguiente']) assert.equal(isHomeRehearsalCommand(value), false);
});
test('a temporary local read failure can be retried without reloading or clearing saved reports', async () => {
  const f = fixture(); let unavailable = true;
  const box = createFeedbackOutbox({ ...f.deps, read: async () => { if (unavailable) throw new Error('temporarily unavailable'); return f.stored(); } });
  await assert.rejects(box.enqueue(report()), /temporarily unavailable/);
  unavailable = false; await box.enqueue(report()); await box.flush();
  assert.equal(f.sent.length, 1); assert.equal(box.getSnapshot().pending, 0);
});
