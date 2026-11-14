const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const { setImmediate: settle } = require('node:timers/promises');
const previous = require.extensions['.ts'];
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { createNativeLevelInput, peakFromDecibels } = require('../src/nativePrototype/levelInput.ts');
if (previous) require.extensions['.ts'] = previous; else delete require.extensions['.ts'];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('native peak levels preserve dBFS scale and digital silence without pretending to be PCM RMS', () => {
  assert.equal(peakFromDecibels(-160), 0);
  assert.equal(peakFromDecibels(-20), 0.1);
  assert.equal(peakFromDecibels(10), 1);
});

test('the native meter waits for physical stop, releases its recorder and deletes only its own temporary recording', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const stopped = deferred(), events = [], levels = [];
  let recording = false;
  const input = createNativeLevelInput({ createRecorder: () => ({ uri: 'file:///cache/calibration.m4a',
    prepareToRecordAsync: async () => {}, record: () => { recording = true; },
    getStatus: () => ({ isRecording: recording, canRecord: recording, metering: -20 }),
    stop: async () => { events.push('stop'); await stopped.promise; recording = false; },
    release: () => events.push('release'),
  }), deleteRecording: async uri => events.push(uri) });
  await input.start(level => levels.push(level), message => { throw Error(message); });
  t.mock.timers.tick(180); assert.equal(levels.length, 4); assert(levels.every(level => level === 0.1));
  const pending = input.stop(); await settle(); assert.deepEqual(events, ['stop']);
  t.mock.timers.tick(180); assert.equal(levels.length, 4, 'No sample can outlive its input owner');
  stopped.resolve(); await pending;
  assert.deepEqual(events, ['stop', 'release', 'file:///cache/calibration.m4a']);
  await input.stop(); assert.equal(events.length, 3);
});

test('cancelling a pending native prepare cannot start recording later', async () => {
  const prepare = deferred(), calls = [];
  const input = createNativeLevelInput({ createRecorder: () => ({ uri: 'file:///cache/pending.m4a',
    prepareToRecordAsync: () => prepare.promise, record: () => calls.push('record'),
    getStatus: () => ({ isRecording: false, canRecord: true }), stop: async () => calls.push('stop'),
    release: () => calls.push('release'),
  }), deleteRecording: async uri => calls.push(uri) });
  const starting = input.start(() => {}, () => {}); await settle();
  const stopping = input.stop(); prepare.resolve(); await Promise.all([starting, stopping]);
  assert.deepEqual(calls, ['release', 'file:///cache/pending.m4a']);
});

test('a native recording error cleans up and permits an independent fresh attempt', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let calls = 0, releases = 0, deleted = 0;
  const input = createNativeLevelInput({ createRecorder: () => {
    const fail = ++calls === 1;
    return { uri: 'file:///cache/attempt-' + calls, prepareToRecordAsync: async () => {},
      record: () => { if (fail) throw Error('Native device failed'); },
      getStatus: () => ({ isRecording: !fail, canRecord: !fail, metering: -160 }),
      stop: async () => {}, release: () => releases++ };
  }, deleteRecording: async () => { deleted++; } });
  await assert.rejects(input.start(() => {}, () => {}), /Native device failed/);
  await input.start(level => assert.equal(level, 0), () => {}); await input.stop();
  assert.equal(releases, 2); assert.equal(deleted, 2);
});
