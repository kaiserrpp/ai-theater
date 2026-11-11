import { WHISPER_MODEL, WHISPER_REVISION, TRANSFORMERS_URL } from './comparison-core.mjs';

self.onmessage = async ({ data }) => {
  try {
    const started = performance.now();
    const { pipeline, env, Tensor } = await import(TRANSFORMERS_URL);
    env.allowLocalModels = false;
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
    const transcribe = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      revision: WHISPER_REVISION, dtype: 'q8', device: 'wasm',
      progress_callback: (progress) => self.postMessage({ type: 'progress', file: progress.file,
        progress: progress.progress, status: progress.status }),
    });
    const loadMs = performance.now() - started;
    self.postMessage({ type: 'processing' });
    const begin = performance.now();
    let languageUsed = data.language;
    if (languageUsed === 'auto') {
      // Transformers.js 3.8.1 defaults to English when language is absent.
      // Ask Whisper's initial decoder for the language logits instead. The
      // reference script is never an input to this audio-based choice.
      const features = await transcribe.processor(data.audio.subarray(0, 30 * 16000));
      const initial = new Tensor('int64', new BigInt64Array([BigInt(transcribe.model.config.decoder_start_token_id)]), [1, 1]);
      const output = await transcribe.model({ input_features: features.input_features, decoder_input_ids: initial });
      const ids = transcribe.model.generation_config.lang_to_id;
      const offset = output.logits.data.length - output.logits.dims.at(-1);
      languageUsed = output.logits.data[offset + ids['<|es|>']] > output.logits.data[offset + ids['<|en|>']] ? 'spanish' : 'english';
    }
    const options = { task: 'transcribe', max_new_tokens: 224, do_sample: false,
      language: languageUsed,
      ...(data.audio.length > 25 * 16000 ? { chunk_length_s: 20, stride_length_s: 3, return_timestamps: true } : {}),
    };
    const result = await transcribe(data.audio, options);
    self.postMessage({ type: 'result', text: result.text || '', loadMs, languageUsed, processingMs: performance.now() - begin });
    await transcribe.dispose();
  } catch (error) {
    self.postMessage({ type: 'error', error: error?.message || String(error) });
  }
};
