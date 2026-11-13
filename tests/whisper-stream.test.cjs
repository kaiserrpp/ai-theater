const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const { setImmediate: settle } = require('node:timers/promises');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (m, filename) => m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { createWhisperStreamDecoder } = require('../src/utils/whisperStreamDecoder.ts');
const { getWhisperSegmentationThreshold } = require('../src/utils/whisperSpeechActivity.ts');
const { scoreLineMatch, getAutomaticLineAdvanceDelay } = require('../src/utils/lineMatching.ts');
if (previousLoader) require.extensions['.ts'] = previousLoader; else delete require.extensions['.ts'];
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const reference = 'Abuela, ¿qué pasó? ¿Por qué gritas? ¿Pasó algo malo?';
const accepted = (heard) => getAutomaticLineAdvanceDelay(reference, heard, heard, scoreLineMatch(reference, heard)) !== null;
const fixture = (t, transcribe) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = []; let cancelled = 0;
  const decoder = createWhisperStreamDecoder(16000, { names: ['Sonny'], vocabulary: ['English'], prompt: 'Sonny. English' }, transcribe, () => cancelled++);
  for (const event of ['result', 'partialresult', 'error']) decoder.on(event, message => events.push({ event, message }));
  t.after(decoder.remove);
  return { decoder, events, cancelled: () => cancelled,
    feed: (seconds, value = 0.2) => decoder.acceptWaveform({ getChannelData: () => new Float32Array(Math.round(seconds * 16000)).fill(value) }),
    run: async () => { t.mock.timers.tick(350); await settle(); } };
};

test('multi-second pauses preserve words and never cause advancement or repeated inference without new speech', async (t) => {
  const calls = [];
  const f = fixture(t, async (audio, context) => { calls.push({ audio, context }); return { text: calls.length === 1 ? 'Abuela qué pasó' : 'por qué gritas pasó algo malo' }; });
  f.feed(1); await f.run();
  assert.equal(accepted(f.events[0].message.result.partial), false);
  f.feed(6, 0); await f.run();
  assert.equal(calls.length, 1);
  assert.equal(f.events.length, 2);
  assert.equal(f.events[1].event, 'result');
  assert.equal(accepted(f.events[1].message.result.text), false, 'finalized partial words still cannot complete an insufficient replica');
  f.feed(2); await f.run();
  assert.equal(calls[1].audio.length, 2 * 16000);
  assert.equal(f.events[1].event, 'result');
  assert.equal(calls[1].context.prompt, 'Sonny. English');
  assert.equal(accepted(`${f.events[1].message.result.text} ${f.events[2].message.result.partial}`), true);
  assert.equal(f.cancelled(), 0);
});

test('leaving a turn discards late neural results and cancels queued recognition work', async (t) => {
  const pending = deferred(); let calls = 0;
  const f = fixture(t, () => { calls++; return pending.promise; });
  f.feed(1); await f.run();
  f.feed(2); f.decoder.remove();
  pending.resolve({ text: reference }); await settle(); await f.run();
  assert.equal(f.events.length, 0); assert.equal(calls, 1); assert.equal(f.cancelled(), 1);
});

test('completed streamed words are evaluated before neural decoding finishes, and late chunks cannot advance another turn', async (t) => {
  const pending = deferred(); let words;
  const f = fixture(t, (_audio, _context, onText) => { words = onText; return pending.promise; });
  f.feed(2); await f.run();
  words('Abuela qué pasó');
  assert.equal(accepted(f.events.at(-1).message.result.partial), false);
  f.feed(5, 0); await f.run();
  assert.equal(f.events.length, 1, 'a pause cannot complete the turn');
  words(reference);
  assert.equal(accepted(f.events.at(-1).message.result.partial), true);
  f.decoder.remove();
  words('late words from the previous actor');
  pending.resolve({ text: 'late result' }); await settle();
  assert.equal(f.events.length, 2); assert.equal(f.cancelled(), 1);
});

test('silence cannot produce prompted names, and neural failures remain errors rather than accepted replies', async (t) => {
  let calls = 0;
  const f = fixture(t, async () => { calls++; throw new Error('model failed'); });
  f.feed(8, 0); await f.run(); assert.equal(calls, 0);
  f.feed(1); await f.run();
  assert.deepEqual(f.events, [{ event: 'error', message: { error: 'model failed' } }]);
  assert.equal(f.cancelled(), 1);
});

test('long audio windows commit words while new audio received during inference is kept for the next window', async (t) => {
  const first = deferred(), lengths = [];
  const f = fixture(t, async audio => { lengths.push(audio.length); return lengths.length === 1 ? first.promise : { text: 'el final' }; });
  f.feed(21); await f.run(); f.feed(2);
  first.resolve({ text: 'las primeras palabras' }); await settle(); await f.run();
  assert.deepEqual(lengths, [21 * 16000, 2 * 16000]);
  assert.equal(f.events[0].event, 'result'); assert.equal(f.events[1].message.result.partial, 'el final');
});

test('a reused capture reads the current context when transcribing, including removal for microphone checks', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let context;
  const received = [];
  const decoder = createWhisperStreamDecoder(16000, () => context, async (_audio, value) => { received.push(value); return { text: '' }; }, () => {});
  const feed = () => decoder.acceptWaveform({ getChannelData: () => new Float32Array(16000).fill(0.2) });
  feed(); t.mock.timers.tick(350); await settle();
  context = { names: ['Sonny'], vocabulary: ['English'], prompt: 'Sonny. English' };
  feed(); t.mock.timers.tick(350); await settle();
  context = undefined;
  feed(); t.mock.timers.tick(350); await settle();
  assert.deepEqual(received, [undefined, { names: ['Sonny'], vocabulary: ['English'], prompt: 'Sonny. English' }, undefined]);
  decoder.remove();
});

test('GPU scheduling reduces the next poll without changing the minimum audio window, and CPU fallback restores its cadence', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let delay = 120, calls = 0;
  const decoder = createWhisperStreamDecoder(16000, undefined, async () => { calls++; return { text: 'Hey' }; }, () => {}, { getSchedulingDelay: () => delay });
  t.after(decoder.remove);
  const feed = seconds => decoder.acceptWaveform({ getChannelData: () => new Float32Array(seconds * 16000).fill(0.2) });
  feed(0.4); t.mock.timers.tick(120); await settle(); assert.equal(calls, 0);
  feed(0.6); t.mock.timers.tick(120); await settle(); assert.equal(calls, 1);
  delay = 350; feed(1); t.mock.timers.tick(120); await settle(); assert.equal(calls, 1);
  t.mock.timers.tick(230); await settle(); assert.equal(calls, 2);
});

test('the exact iPhone fluent ending no longer waits for the 20-second window after decoded speech settles', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const expected = 'Tengo noticias. My Enlgish is getting much better.';
  const heard = 'I think, no, defias, my English is getting much better.';
  const score = scoreLineMatch(expected, heard), events = [], finalizations = [];
  assert.equal(getAutomaticLineAdvanceDelay(expected, heard, heard, score), null, 'reproduces 218 provisional stall');
  const decoder = createWhisperStreamDecoder(16000, undefined, async () => ({ text: heard }), () => {}, {
    getSpeechThreshold: () => 0.006, onFinalized: info => finalizations.push(info),
  });
  t.after(decoder.remove);
  decoder.on('partialresult', message => events.push({ kind: 'partial', text: message.result.partial }));
  decoder.on('result', message => events.push({ kind: 'final', text: message.result.text }));
  const feed = (seconds, value) => decoder.acceptWaveform({ getChannelData: () => new Float32Array(Math.round(seconds * 16000)).fill(value) });
  feed(3, 0.1); t.mock.timers.tick(350); await settle();
  assert.equal(events.length, 1);
  feed(0.7, 0.0003); await settle();
  assert.deepEqual(events[1], { kind: 'final', text: heard });
  assert.equal(getAutomaticLineAdvanceDelay(expected, events[1].text, '', scoreLineMatch(expected, events[1].text)), 0);
  assert.equal(finalizations[0].segmentFinalization, 'speech_gap');
  assert(finalizations[0].trailingQuietMs >= 600);
});

test('an old inference cannot finalize while later speech has not been decoded', async t => {
  const first = deferred();
  const f = fixture(t, async () => f.events.length ? { text: reference } : first.promise);
  f.feed(1); await f.run(); f.feed(1); f.feed(1, 0);
  first.resolve({ text: 'Abuela qué pasó' }); await settle();
  assert.equal(f.events.length, 1); assert.equal(f.events[0].event, 'partialresult');
  await f.run();
  assert.equal(f.events.at(-1).event, 'result'); assert.equal(f.events.at(-1).message.result.text, reference);
});

test('quiet words arriving during inference are preserved across a segment boundary', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = deferred(), audios = [];
  const decoder = createWhisperStreamDecoder(16000, undefined, async audio => {
    audios.push(audio); return audios.length === 1 ? first.promise : { text: 'por qué gritas' };
  }, () => {}, { getSpeechThreshold: () => 0.006 });
  t.after(decoder.remove);
  const feed = (seconds, value) => decoder.acceptWaveform({ getChannelData: () => new Float32Array(Math.round(seconds * 16000)).fill(value) });
  feed(1, 0.1); t.mock.timers.tick(350); await settle();
  feed(0.8, 0.0002); feed(0.7, 0);
  first.resolve({ text: 'Abuela qué pasó' }); await settle();
  t.mock.timers.tick(350); await settle();
  assert.equal(audios.length, 2); assert.equal(audios[1].length, 1.5 * 16000);
  assert.equal(audios[1][0], Math.fround(0.0002));
});

test('segmentation uses measured voice/noise levels without imposing the silence detector minimum on quiet voices', () => {
  assert(Math.abs(getWhisperSegmentationThreshold(0.0002, 0.002) - 0.0003) < 1e-9);
  assert(getWhisperSegmentationThreshold(0.001, 0.03) < 0.006);
  assert.equal(getWhisperSegmentationThreshold(NaN, 0), 0.0001);
});

test('comparison can explicitly finish a short take without changing normal streaming', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let finished=0;const events=[];
  const decoder=createWhisperStreamDecoder(16000,undefined,async audio=>{assert.equal(audio.length,8000);return{text:'Sí'}},()=>{},
    {allowFinishInput:true,onInputFinished:()=>finished++});
  t.after(decoder.remove);decoder.on('result',message=>events.push(message.result.text));
  decoder.acceptWaveform({getChannelData:()=>new Float32Array(8000).fill(.1)});
  assert.equal(decoder.finishInput(),true);t.mock.timers.tick(0);await settle();
  assert.deepEqual(events,['Sí']);assert.equal(finished,1);assert.equal(decoder.finishInput(),false);
  const normal=createWhisperStreamDecoder(16000,undefined,async()=>({text:'nada'}),()=>{});
  assert.equal(normal.finishInput,undefined);normal.remove();
});

test('finishing during an inference preserves and decodes the later words before reporting completion', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const first=deferred(),second=deferred(),calls=[],finals=[];let finished=0;
  const decoder=createWhisperStreamDecoder(16000,undefined,async audio=>{calls.push(audio);return calls.length===1?first.promise:second.promise},()=>{},
    {allowFinishInput:true,onInputFinished:()=>finished++});
  t.after(decoder.remove);decoder.on('result',m=>finals.push(m.result.text));
  decoder.acceptWaveform({getChannelData:()=>new Float32Array(16000).fill(.1)});t.mock.timers.tick(350);await settle();
  decoder.acceptWaveform({getChannelData:()=>new Float32Array(12800).fill(.2)});decoder.finishInput();
  first.resolve({text:'primera parte'});await settle();t.mock.timers.tick(0);await settle();
  assert.equal(calls.length,2);assert.equal(calls[1].length,12800);assert.equal(finished,0);
  second.resolve({text:'últimas palabras'});await settle();assert.equal(finished,1);
  assert.deepEqual(finals,['primera parte','últimas palabras']);
});
