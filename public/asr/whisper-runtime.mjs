import { WHISPER_MODEL, WHISPER_REVISION, TRANSFORMERS_URL, SAMPLE_RATE } from './comparison-core.mjs';

let runtime;
export const loadWhisper = (onProgress = () => {}) => runtime ??= (async () => {
  const { pipeline, env, Tensor } = await import(TRANSFORMERS_URL);
  env.allowLocalModels = false;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.proxy = false;
  const transcribe = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
    revision: WHISPER_REVISION, dtype: 'q8', device: 'wasm', progress_callback: onProgress,
  });
  return { transcribe, Tensor };
})().catch((error) => { runtime = null; throw error; });

export const whisperPrefix = (tokenizer, config, language, prompt, timestamps = false) => {
  const prefix = [config.decoder_start_token_id, config.lang_to_id[language === 'spanish' ? '<|es|>' : '<|en|>'], config.task_to_id.transcribe];
  if (!timestamps) prefix.push(config.no_timestamps_token_id);
  if (!prompt?.trim()) return prefix;
  let bounded = prompt, tokens;
  // Fit whole vocabulary entries; truncating BPE tokens could teach half of
  // a name. Drop entries from the end, preserving the priority order.
  while (bounded) {
    tokens = tokenizer.encode(` ${bounded}`, { add_special_tokens: false });
    if (tokens.length <= 96) break;
    const separator = bounded.lastIndexOf(',');
    bounded = separator < 0 ? '' : bounded.slice(0, separator);
  }
  if (!bounded || !tokens?.length) return prefix;
  const previous = tokenizer.model.convert_tokens_to_ids(['<|startofprev|>'])[0];
  if (!Number.isInteger(previous) || previous < 0) throw new Error('Whisper no admite contexto en este modelo.');
  return [previous, ...tokens, ...prefix];
};

export const generatedAudioTokens = (output, prefix) => {
  const tokens = output.tolist()[0];
  if (!prefix.every((token, i) => Number(tokens[i]) === token)) throw new Error('Whisper devolvió un prefijo de contexto inesperado.');
  // Never decode the vocabulary as if the actor had said it.
  return tokens.slice(prefix.length);
};

export const transcribeWhisperAudio = async (audio, { language = 'auto', context = null, onProgress = () => {}, onProcessing = () => {} } = {}) => {
  const loadedAt = performance.now();
  const { transcribe, Tensor } = await loadWhisper(onProgress);
  const loadMs = performance.now() - loadedAt, started = performance.now();
  onProcessing();
  let languageUsed = language;
  if (!audio.some((value) => Math.abs(value) > 0.00001)) return { text: '', loadMs, processingMs: performance.now() - started, languageUsed: null };
  if (languageUsed === 'auto') {
    const features = await transcribe.processor(audio.subarray(0, 30 * SAMPLE_RATE));
    const initial = new Tensor('int64', new BigInt64Array([BigInt(transcribe.model.config.decoder_start_token_id)]), [1, 1]);
    const output = await transcribe.model({ input_features: features.input_features, decoder_input_ids: initial });
    const ids = transcribe.model.generation_config.lang_to_id;
    const offset = output.logits.data.length - output.logits.dims.at(-1);
    languageUsed = output.logits.data[offset + ids['<|es|>']] > output.logits.data[offset + ids['<|en|>']] ? 'spanish' : 'english';
  }
  const prompt = typeof context?.prompt === 'string' ? context.prompt.slice(0, 600) : '';
  let text, contextPrompt = null;
  if (!prompt) {
    const result = await transcribe(audio, { task: 'transcribe', language: languageUsed, max_new_tokens: 224, do_sample: false,
      ...(audio.length > 25 * SAMPLE_RATE ? { chunk_length_s: 20, stride_length_s: 3, return_timestamps: true } : {}),
    });
    text = result.text || '';
  } else {
    const timestamps = audio.length > 25 * SAMPLE_RATE;
    const prefix = whisperPrefix(transcribe.tokenizer, transcribe.model.generation_config, languageUsed, prompt, timestamps);
    contextPrompt = transcribe.tokenizer.decode(prefix.slice(1, -(timestamps ? 3 : 4)), { skip_special_tokens: true }).trim();
    const chunks = [], width = 20 * SAMPLE_RATE, overlap = 3 * SAMPLE_RATE;
    for (let offset = 0; ;) {
      const end = timestamps ? Math.min(offset + width, audio.length) : audio.length;
      const features = await transcribe.processor(audio.subarray(offset, end));
      const output = await transcribe.model.generate({ inputs: features.input_features, decoder_input_ids: prefix,
        language: languageUsed, task: 'transcribe', return_timestamps: timestamps, max_new_tokens: 224, do_sample: false });
      const tokens = generatedAudioTokens(output, prefix);
      if (!timestamps) { text = transcribe.tokenizer.decode(tokens, { skip_special_tokens: true }); break; }
      chunks.push({ tokens, stride: [(end - offset) / SAMPLE_RATE, offset ? 3 : 0, end < audio.length ? 3 : 0], is_last: end === audio.length });
      if (end === audio.length) {
        [text] = transcribe.tokenizer._decode_asr(chunks, { return_timestamps: false,
          time_precision: transcribe.processor.feature_extractor.config.chunk_length / transcribe.model.config.max_source_positions,
          force_full_sequences: true });
        break;
      }
      offset += width - 2 * overlap;
    }
  }
  return { text: text.trim(), loadMs, languageUsed, processingMs: performance.now() - started,
    contextUsed: Boolean(contextPrompt), contextPrompt,
    contextTermCount: contextPrompt ? contextPrompt.split(/[,\.]/).filter((term) => term.trim()).length : 0 };
};
