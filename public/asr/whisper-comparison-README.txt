Local transcription comparison and optional live rehearsal, AI-Theatre 2026.11.214

Whisper: multilingual Tiny model, ONNX q8 conversion by Xenova.
Repository: https://huggingface.co/Xenova/whisper-tiny
Pinned model revision: 5332fcc35e32a33b86612b9a57a89be7906102b1
Original model and MIT license: https://github.com/openai/whisper

Browser runtime: Transformers.js 3.8.1, Apache-2.0.
https://github.com/huggingface/transformers.js
ONNX Runtime Web included by that distribution, MIT license.
https://github.com/microsoft/onnxruntime

Vosk browser library 0.0.8, Apache-2.0.
https://github.com/ccoreilly/vosk-browser
Spanish model: vosk-model-small-es-0.42, hosted beside this file.
See README.txt and LICENSE-2.0.txt for its source and license.

The libraries are loaded from pinned jsDelivr URLs. Whisper model files are
downloaded by the browser from the pinned Hugging Face revision and may be
cached by the browser. No model weights are included in the application bundle.
The audio is processed on the device. Only text and timing reports are sent,
and only after the user presses the report button.

Script context is a bounded vocabulary, not an expected reply. It is encoded
in Whisper's decoder prefix. Tokens from that prefix are removed before
transcript decoding. The pinned Transformers.js implementation does not apply
prompt_ids itself; see its Whisper generation source. Chunk merging uses that
runtime's tokenizer._decode_asr, as in its ASR pipeline (Apache-2.0).
https://github.com/huggingface/transformers.js/blob/3.8.1/src/models.js
https://github.com/huggingface/transformers.js/blob/3.8.1/src/pipelines.js

Live recognition uses whisper-live-runtime.mjs. It shares encoder outputs
between language detection and generation, enables that supported input in
Whisper's 3.8.1 forward-parameter allow-list, streams complete audio words with
TextStreamer (skip_prompt), and checks cancellation between decoder steps.
The separate offline comparison retains the original transcription path.

Since 2026.11.218 the live path can run the original fp32 encoder on WebGPU,
keeping the q8 decoder on WASM. Both variants use the same pinned model
revision. The encoder is warmed before opening capture; unsupported/lost GPU
resources are disposed and live Whisper continues on WASM q8. Backend and
browser response-event timings are included in text-only rehearsal reports.
https://github.com/huggingface/transformers.js/blob/3.8.1/src/generation/streamers.js
https://github.com/huggingface/transformers.js/blob/3.8.1/src/generation/stopping_criteria.js
