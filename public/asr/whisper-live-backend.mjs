import { createWhisperRuntime } from './whisper-runtime.mjs';

// Keep Whisper selected when hardware acceleration is unavailable. Only its
// encoder backend changes; actor matching, capture and pause handling do not.
export const createWhisperBackendManager = ({ createRuntime, hasGPU, warm, dispose }) => {
  let pending = null, fallbackReason = null;
  const cpu = async () => ({ ...await createRuntime({ device: 'wasm', dtype: 'q8' }),
    encoderDevice: 'wasm', decoderDevice: 'wasm', encoderDtype: 'q8', fallbackReason });
  const load = () => pending ??= (async () => {
    if (fallbackReason === null) {
      let candidate;
      try {
        if (await hasGPU()) {
          candidate = await createRuntime({
            device: { encoder_model: 'webgpu', decoder_model_merged: 'wasm' },
            dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
          });
          await warm(candidate);
          return { ...candidate, encoderDevice: 'webgpu', decoderDevice: 'wasm', encoderDtype: 'fp32', fallbackReason: null };
        }
        fallbackReason = 'WebGPU no disponible';
      } catch (error) {
        fallbackReason = String(error?.message || error).slice(0, 180);
        if (candidate) await dispose(candidate).catch(() => {});
      }
    }
    return cpu();
  })().catch(error => { pending = null; throw error; });
  return {
    load,
    useCPU: async (previous, error) => {
      if (previous.encoderDevice !== 'webgpu') throw error;
      const current = await load();
      if (current !== previous) return current;
      fallbackReason = String(error?.message || error).slice(0, 180);
      await dispose(previous).catch(() => {});
      pending = null;
      return load();
    },
  };
};

export const liveWhisperBackend = createWhisperBackendManager({
  createRuntime: createWhisperRuntime,
  hasGPU: async () => typeof navigator !== 'undefined' && Boolean(await navigator.gpu?.requestAdapter()),
  warm: async ({ transcribe }) => {
    // Compile the fixed encoder graph before reporting the microphone ready.
    const { input_features } = await transcribe.processor(new Float32Array(16000));
    await transcribe.model._prepare_encoder_decoder_kwargs_for_generation({
      inputs_tensor: input_features, model_inputs: { input_features }, model_input_name: 'input_features',
      generation_config: transcribe.model.generation_config,
    });
  },
  dispose: async runtime => { await runtime.transcribe.dispose(); },
});
