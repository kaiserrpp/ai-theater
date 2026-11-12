const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const runtime = import(pathToFileURL(path.resolve(__dirname, '../public/asr/whisper-live-runtime.mjs')));

const fixture = () => {
  const features = {}, encoded = {}, calls = { features: 0, encoder: 0, language: 0 }, partials = [];
  let cancelled = false;
  const config = { decoder_start_token_id: 10, lang_to_id: { '<|es|>': 1, '<|en|>': 2 }, task_to_id: { transcribe: 13 }, no_timestamps_token_id: 14 };
  const model = Object.assign(async input => {
    calls.language++;
    assert.equal(input.encoder_outputs, encoded);
    return { logits: { data: [0, 3, 1], dims: [1, 1, 3] } };
  }, { config, generation_config: config, forward_params: ['input_features'], forward: async () => {},
    _get_stopping_criteria: () => [],
    _prepare_encoder_decoder_kwargs_for_generation: async ({ model_inputs }) => {
      calls.encoder++; assert.equal(model_inputs.input_features, features); return { encoder_outputs: encoded };
    },
    generate: async options => {
      // Reproduce the pinned library's allow-list, which otherwise drops the
      // shared tensor and silently runs the costly encoder a second time.
      assert(model.forward_params.includes('encoder_outputs'));
      assert.equal(options.encoder_outputs, encoded);
      assert.equal(options.inputs, features);
      options.streamer.put([options.decoder_input_ids]);
      assert.deepEqual(partials, [], 'script vocabulary never enters the transcript');
      options.streamer.put([[200]]);
      assert.deepEqual(partials, ['prueba de']);
      options.streamer.end();
      assert.deepEqual(model._get_stopping_criteria()[0]._call([[200]]), [cancelled]);
      return { tolist: () => [[...options.decoder_input_ids, 200, 201]] };
    },
  });
  const tokenizer = { encode: () => [100], model: { convert_tokens_to_ids: () => [9] }, decode: tokens => tokens[0] === 100 ? 'Sonny' : 'prueba de micro' };
  class TextStreamer {
    constructor(_tokenizer, options) { this.options = options; this.prefix = true; }
    put() { if (this.prefix) { this.prefix = false; if (!this.options.skip_prompt) this.options.callback_function('Sonny '); }
      else this.options.callback_function('prueba de '); }
    end() { this.options.callback_function('micro'); }
  }
  class Tensor {}
  class StoppingCriteria {}
  return { calls, partials, model, cancel: () => { cancelled = true; },
    options: { context: { prompt: 'Sonny' }, onText: text => partials.push(text), isCancelled: () => cancelled },
    loaded: { transcribe: { model, tokenizer, processor: async () => { calls.features++; return { input_features: features }; } }, Tensor, TextStreamer, StoppingCriteria } };
};

test('live detection and transcription share one feature extraction and encoder pass, and stream only audio words', async () => {
  const { runWhisperLiveTranscription: transcribe } = await runtime;
  const f = fixture(), forward = f.model.forward, getStoppingCriteria = f.model._get_stopping_criteria;
  const result = await transcribe(f.loaded, new Float32Array(16000).fill(0.2), f.options);
  assert.deepEqual(f.calls, { features: 1, encoder: 1, language: 1 });
  assert.deepEqual(f.partials, ['prueba de', 'prueba de micro']);
  assert.equal(result.text, 'prueba de micro');
  assert.equal(result.contextPrompt, 'Sonny');
  assert.equal(result.languageUsed, 'spanish');
  assert.equal(f.model.forward, forward);
  assert.equal(f.model._get_stopping_criteria, getStoppingCriteria);
});

test('Spanish setup/scene commands skip language detection, while cancelled/silent input produces no words', async () => {
  const { runWhisperLiveTranscription: transcribe } = await runtime;
  const f = fixture();
  await transcribe(f.loaded, new Float32Array(16000).fill(0.2), { ...f.options, language: 'spanish' });
  assert.equal(f.calls.language, 0);
  const silent = fixture();
  assert.equal((await transcribe(silent.loaded, new Float32Array(16000), silent.options)).text, '');
  assert.equal(silent.calls.encoder, 0); assert.deepEqual(silent.partials, []);
  const cancelled = fixture(); cancelled.cancel();
  await assert.rejects(transcribe(cancelled.loaded, new Float32Array(16000).fill(0.2), cancelled.options), { name: 'AbortError' });
  assert.equal(cancelled.calls.encoder, 0); assert.deepEqual(cancelled.partials, []);
});

test('cancelling during generation suppresses later words and restores the shared model for the next turn', async () => {
  const { runWhisperLiveTranscription: transcribe } = await runtime;
  const f = fixture(), forward = f.model.forward, getStoppingCriteria = f.model._get_stopping_criteria;
  f.model.generate = async options => {
    options.streamer.put([options.decoder_input_ids]);
    f.cancel(); options.streamer.put([[200]]); options.streamer.end();
    assert.deepEqual(f.model._get_stopping_criteria()[0]._call([[200]]), [true]);
    return { tolist: () => [[...options.decoder_input_ids, 200]] };
  };
  await assert.rejects(transcribe(f.loaded, new Float32Array(16000).fill(0.2), f.options), { name: 'AbortError' });
  assert.deepEqual(f.partials, []); assert.equal(f.model.forward, forward);
  assert.equal(f.model._get_stopping_criteria, getStoppingCriteria);
});
