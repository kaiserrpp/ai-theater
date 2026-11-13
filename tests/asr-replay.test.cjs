const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: settle } = require('node:timers/promises');
const timing = import('../public/asr/comparison-timing.mjs');
const nativeModule = import('../public/asr/comparison-native.mjs');

test('replay keeps pauses and original PCM, separates model preparation, and measures actual word acceptance', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { replaySample } = await timing;
  let time = 0, removed = 0, count = 0;
  const listeners = {}, received = [];
  const audio = new Float32Array(16000 * 4); audio.fill(0.2, 0, 16000); audio.fill(0.3, 16000 * 3);
  const result = await replaySample({ audio, expected: 'Abuela que pasó porque gritas pasó algo malo', signal: new AbortController().signal,
    now: () => time, wait: async ms => { time += ms; t.mock.timers.tick(ms); await settle(); },
    createRecognizer: async () => {
      time += 5000;
      return { recognizer: { on: (event, callback) => { listeners[event] = callback; }, remove: () => removed++,
        acceptWaveform: buffer => {
          const chunk = buffer.getChannelData(0); received.push(...chunk); count += chunk.length;
          if (count === 16000) listeners.result({ result: { text: 'Abuela que pasó' } });
          if (count === 16000 * 4) listeners.result({ result: { text: 'porque gritas pasó algo malo' } });
        } }, isIdle: () => true, details: () => ({ backend: 'wasm' }) };
    } });
  assert.equal(result.loadMs, 5000);
  assert.equal(result.replay.acceptedAtMs, 4000);
  assert.equal(result.replay.inputEndMs, 4000);
  assert.equal(result.replay.firstTextMs, 1000);
  assert.equal(result.replay.events.length, 2);
  assert.equal(result.replay.finishReason, 'settled');
  assert.equal(removed, 1);
  assert.deepEqual(new Float32Array(received.slice(0, audio.length)), audio);
  assert.equal(result.text, 'Abuela que pasó porque gritas pasó algo malo');
});

test('a provisional negation from the real iPhone report waits for ASR finalization, not a rewritten script', async () => {
  const { createDecisionTracker } = await timing;
  let time = 0;
  const tracker = createDecisionTracker({ expected: 'Tengo noticias. My Enlgish is getting much better.', now: () => time });
  const heard = 'I think, no, defias, my English is getting much better.';
  time = 800; tracker.update(heard, heard, 3000);
  assert.equal(tracker.snapshot().acceptedAtMs, null);
  time = 1500; tracker.update(heard, '', 3600);
  assert.equal(tracker.snapshot().acceptedAtMs, 1500);
  assert.equal(tracker.snapshot().decisionText, heard);
  tracker.dispose();
});

test('cancelled replay releases the recognizer and does not invent an accepted result', async () => {
  const { replaySample } = await timing;
  const controller = new AbortController(); let removed = 0;
  await assert.rejects(replaySample({ audio: new Float32Array(16000), expected: 'Sí', signal: controller.signal,
    wait: async () => controller.abort(), createRecognizer: async () => ({ recognizer: {
      on() {}, acceptWaveform() { throw Error('should not receive cancelled input'); }, remove: () => removed++,
    }, isIdle: () => true, details: () => ({}) }) }), { name: 'AbortError' });
  assert.equal(removed, 1);
});

test('a corrected provisional hypothesis cancels acceptance, and delayed decisions record the current input position', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { createDecisionTracker } = await timing;
  let time = 0, position = 800;
  const tracker = createDecisionTracker({ expected: 'Sí', now: () => time, getAudioMs: () => position });
  tracker.update('Sí', 'Sí', position);
  time += 30; t.mock.timers.tick(30); tracker.update('No', 'No', position);
  time += 100; t.mock.timers.tick(100); assert.equal(tracker.snapshot().acceptedAtMs, null);
  tracker.update('Sí', 'Sí', position); position = 960;
  time += 60; t.mock.timers.tick(60);
  assert.equal(tracker.snapshot().acceptedAudioMs, 960); assert.equal(tracker.snapshot().acceptedAtMs, 190);
  tracker.dispose();
});

const nativeFixture = async () => {
  const { createNativeComparison } = await nativeModule;
  const handles = [], states = [], results = [];
  let time = 0, stops = 0, aborts = 0, cues = 0;
  class Native {
    constructor() { handles.push(this); }
    start() { this.onaudiostart(); }
    stop() { stops++; }
    abort() { aborts++; }
  }
  const comparison = createNativeComparison({ Constructor: Native,
    device: { userAgent: 'iPhone Version/27.2' }, now: () => time,
    onState: value => states.push(value), onResult: value => results.push(value),
    prepareContinuation: done => { cues++; done(); return () => {}; } });
  return { comparison, handles, states, results, tick: ms => { time += ms; },
    counters: () => ({ stops, aborts, cues }),
    words: (text, isFinal = false) => handles.at(-1).onresult({ results: [{ isFinal, 0: { transcript: text } }] }) };
};

test('Safari gets its own take, preserves words during a pause and waits for natural closure before releasing other inputs', async () => {
  const f = await nativeFixture();
  f.comparison.start({ expected: 'Abuela que pasó porque gritas pasó algo malo', language: 'spanish' });
  f.tick(800); f.words('Abuela que pasó'); f.handles[0].onend();
  assert.equal(f.results.length, 0); assert.equal(f.states.at(-1).canContinue, true);
  f.tick(2000); f.comparison.start({ expected: 'not used', language: 'english' });
  assert.equal(f.counters().cues, 1); assert.equal(f.handles[1].lang, 'es-ES');
  f.tick(700); f.words('porque gritas pasó algo malo', true);
  f.comparison.finish(); assert.equal(f.states.at(-1).busy, true); assert.equal(f.results.length, 0);
  assert.deepEqual(f.counters(), { stops: 0, aborts: 0, cues: 1 });
  f.tick(900); f.handles[1].onend();
  assert.equal(f.results[0].text, 'Abuela que pasó porque gritas pasó algo malo');
  assert.equal(f.results[0].timingKind, 'native_live');
  assert.equal(f.results[0].native.endWaitMs, 900); assert.equal(f.results[0].accepted, true);
  assert.equal(f.results[0].native.matchToInputEndMs, 900); assert.equal(f.results[0].native.inputEndSignal, 'end');
  assert.equal(f.states.at(-1).busy, false);
});

test('a rejected Safari start leaves no phantom capture, and page interruption ignores stale events without abort', async () => {
  const { createNativeComparison } = await nativeModule;
  let result;
  const rejected = createNativeComparison({ Constructor: class { start() { throw Error('permission denied'); } },
    device: { userAgent: 'iPhone Version/27.2' }, onResult: value => { result = value; } });
  rejected.start({ expected: 'Sí', language: 'spanish' }); assert.equal(result.status, 'error');
  const f = await nativeFixture(); f.comparison.start({ expected: 'Sí', language: 'spanish' });
  const late = f.handles[0].onresult; f.comparison.suspend();
  late({ results: [{ isFinal: true, 0: { transcript: 'Sí' } }] });
  assert.equal(f.results.length, 1); assert.equal(f.results[0].text, '');
  assert.equal(f.counters().aborts, 0);
});

test('an audioend before final text is remembered instead of reporting the later service end as capture delay', async () => {
  const f = await nativeFixture();
  f.comparison.start({ expected: 'Sí', language: 'spanish' });
  f.tick(800); f.handles[0].onaudioend();
  f.tick(100); f.words('Sí', true); f.comparison.finish();
  f.tick(2000); f.handles[0].onend();
  assert.equal(f.results[0].native.inputEndSignal, 'audioend');
  assert.equal(f.results[0].native.matchToInputEndMs, 0);
  assert.equal(f.results[0].native.serviceEndMs, 2900);
});
