const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const backend = import(pathToFileURL(path.resolve(__dirname, '../public/asr/whisper-live-backend.mjs')));
const fixture = async (supported = true, warmError = null) => {
  const { createWhisperBackendManager } = await backend;
  const calls = [], disposed = [];
  let warmed = 0, probes = 0;
  const manager = createWhisperBackendManager({
    hasGPU: async () => { probes++; return supported; },
    createRuntime: async options => { calls.push(options); return { transcribe: { id: calls.length } }; },
    warm: async () => { warmed++; if (warmError) throw warmError; },
    dispose: async runtime => { disposed.push(runtime.transcribe.id); },
  });
  return { manager, calls, disposed, warmed: () => warmed, probes: () => probes };
};

test('live Whisper warms a supported GPU encoder once and retains the q8 WASM decoder', async () => {
  const f = await fixture(); const runtime = await f.manager.load();
  assert.equal(runtime.encoderDevice, 'webgpu'); assert.equal(runtime.decoderDevice, 'wasm');
  assert.equal(runtime.encoderDtype, 'fp32'); assert.equal(runtime.fallbackReason, null);
  assert.deepEqual(f.calls, [{ device: { encoder_model: 'webgpu', decoder_model_merged: 'wasm' }, dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' } }]);
  assert.equal(await f.manager.load(), runtime); assert.equal(f.warmed(), 1);
});

test('missing GPU or failed compilation uses Whisper on CPU, without repeatedly loading a broken backend', async () => {
  const absent = await fixture(false); const cpu = await absent.manager.load();
  assert.equal(cpu.encoderDevice, 'wasm'); assert.equal(absent.warmed(), 0);
  assert.deepEqual(absent.calls, [{ device: 'wasm', dtype: 'q8' }]);
  const failed = await fixture(true, new Error('GPU compilation rejected'));
  const fallback = await failed.manager.load();
  assert.equal(fallback.encoderDevice, 'wasm'); assert.equal(fallback.fallbackReason, 'GPU compilation rejected');
  assert.deepEqual(failed.disposed, [1]); assert.equal(failed.calls.length, 2);
  assert.equal(await failed.manager.load(), fallback); assert.equal(failed.probes(), 1);
});

test('losing the GPU after setup disposes it and keeps CPU Whisper for subsequent turns; CPU errors stay errors', async () => {
  const f = await fixture(); const gpu = await f.manager.load();
  const cpu = await f.manager.useCPU(gpu, new Error('device lost'));
  assert.equal(cpu.encoderDevice, 'wasm'); assert.equal(cpu.fallbackReason, 'device lost');
  assert.deepEqual(f.disposed, [1]); assert.equal(f.probes(), 1); assert.equal(await f.manager.load(), cpu);
  const failure = new Error('CPU transcription failed');
  await assert.rejects(f.manager.useCPU(cpu, failure), failure);
  assert.equal(f.calls.length, 2);
});
