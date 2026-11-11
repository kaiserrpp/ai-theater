Local transcription comparison, AI-Theatre 2026.11.211

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
