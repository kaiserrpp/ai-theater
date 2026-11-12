import { whisperPrefix, generatedAudioTokens } from './whisper-runtime.mjs';
import { liveWhisperBackend } from './whisper-live-backend.mjs';

const cancelledError = () => Object.assign(new Error('Escucha cancelada.'), { name: 'AbortError' });

// The comparison keeps its original offline path. Live recognition encodes each
// growing audio window once, sharing that tensor with detection and generation.
export const runWhisperLiveTranscription = async ({ transcribe, Tensor, TextStreamer, StoppingCriteria,
  encoderDevice = 'wasm', decoderDevice = 'wasm', encoderDtype = 'q8', fallbackReason = null }, audio, {
  context, language = 'auto', onText = () => {}, isCancelled = () => false,
} = {}) => {
  const started = performance.now();
  const backend = { encoderDevice, decoderDevice, encoderDtype, fallbackReason };
  const check = () => { if (isCancelled()) throw cancelledError(); };
  check();
  if (!audio.some(value => Math.abs(value) > 0.00001)) return { text: '', processingMs: 0, languageUsed: null };
  const features = await transcribe.processor(audio);
  check();
  const featuresAt = performance.now();
  const model = transcribe.model;
  // Whisper 3.8.1 omits this supported forward input from its allow-list.
  // Without it, generate() silently drops the tensor and encodes again.
  if (!model.forward_params.includes('encoder_outputs')) model.forward_params.push('encoder_outputs');
  // This adapter is pinned to Transformers.js 3.8.1. Its preparation method
  // returns the same encoder_outputs accepted by forward() and generate().
  const { encoder_outputs } = await model._prepare_encoder_decoder_kwargs_for_generation({
    inputs_tensor: features.input_features, model_inputs: { input_features: features.input_features },
    model_input_name: 'input_features', generation_config: model.generation_config,
  });
  check();
  const encodedAt = performance.now();
  let languageUsed = language;
  if (languageUsed === 'auto') {
    const initial = new Tensor('int64', new BigInt64Array([BigInt(model.config.decoder_start_token_id)]), [1, 1]);
    const output = await model({ encoder_outputs, decoder_input_ids: initial });
    check();
    const ids = model.generation_config.lang_to_id;
    const offset = output.logits.data.length - output.logits.dims.at(-1);
    languageUsed = output.logits.data[offset + ids['<|es|>']] > output.logits.data[offset + ids['<|en|>']] ? 'spanish' : 'english';
  }
  const languageAt = performance.now();
  const prompt = typeof context?.prompt === 'string' ? context.prompt.slice(0, 600) : '';
  const prefix = whisperPrefix(transcribe.tokenizer, model.generation_config, languageUsed, prompt);
  const contextPrompt = prompt && prefix.length > 4
    ? transcribe.tokenizer.decode(prefix.slice(1, -4), { skip_special_tokens: true }).trim() : null;
  let partial = '', emitted = '';
  const streamer = new TextStreamer(transcribe.tokenizer, {
    skip_prompt: true,
    callback_function: chunk => {
      partial += chunk;
      const text = partial.trim();
      if (!isCancelled() && text && text !== emitted) {
        emitted = text;
        // TextStreamer emits completed words, so a partial BPE token cannot
        // masquerade as a completed word/negation in the Intelligent matcher.
        onText(text, { processingMs: performance.now() - started, ...backend });
      }
    },
  });
  const stopping = new class extends StoppingCriteria {
    _call(ids) { return ids.map(() => isCancelled()); }
  }();
  const forward = model.forward;
  const getStoppingCriteria = model._get_stopping_criteria;
  let steps = 0;
  // Whisper.generate() in the pinned release drops stopping_criteria before
  // calling the base generator. Install the criterion at the point where the
  // base generator actually builds its list, preserving Whisper's processors.
  model._get_stopping_criteria = function (...args) {
    const criteria = getStoppingCriteria.apply(this, args);
    criteria.push(stopping);
    return criteria;
  };
  // WASM promises can resolve in one long microtask chain. Yield periodically
  // so cancel messages can stop obsolete decoding before the next turn queues.
  model.forward = async function (...args) {
    if (++steps % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    return forward.apply(this, args);
  };
  try {
    const output = await model.generate({ inputs: features.input_features, encoder_outputs,
      decoder_input_ids: prefix, language: languageUsed, task: 'transcribe', return_timestamps: false,
      max_new_tokens: 224, do_sample: false, streamer });
    check();
    const text = transcribe.tokenizer.decode(generatedAudioTokens(output, prefix), { skip_special_tokens: true }).trim();
    return { text, languageUsed, ...backend, contextUsed: Boolean(contextPrompt), contextPrompt,
      contextTermCount: contextPrompt ? contextPrompt.split(/[,\.]/).filter(term => term.trim()).length : 0,
      processingMs: performance.now() - started, featureMs: featuresAt - started,
      encoderMs: encodedAt - featuresAt, languageMs: languageAt - encodedAt,
      decoderMs: performance.now() - languageAt };
  } finally {
    model.forward = forward;
    model._get_stopping_criteria = getStoppingCriteria;
  }
};

export const loadLiveWhisper = () => liveWhisperBackend.load();
export const transcribeWhisperLiveAudio = async (audio, options) => {
  const runtime = await loadLiveWhisper();
  try { return await runWhisperLiveTranscription(runtime, audio, options); }
  catch (error) {
    if (runtime.encoderDevice !== 'webgpu' || error?.name === 'AbortError' || options?.isCancelled?.()) throw error;
    const fallback = await liveWhisperBackend.useCPU(runtime, error);
    return runWhisperLiveTranscription(fallback, audio, options);
  }
};
