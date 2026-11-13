import { SAMPLE_RATE, checkAbort, abortError } from './comparison-core.mjs';
import { APP_VERSION } from './comparison-version.mjs';
import { replaySample } from './comparison-timing.mjs';
import { createWhisperStreamDecoder } from './whisperStreamDecoder.mjs';

let voskLibrary;
const abortable = (promise, signal) => new Promise((resolve, reject) => {
  checkAbort(signal);
  const abort = () => reject(abortError());
  signal.addEventListener('abort', abort, { once: true });
  promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
});
const loadVoskLibrary = () => voskLibrary ??= new Promise((resolve, reject) => {
  if (window.Vosk) { resolve(window.Vosk); return; }
  const script = document.createElement('script');
  const timeout = setTimeout(() => { voskLibrary = null; script.remove(); reject(new Error('La descarga de Vosk ha tardado demasiado. Reintenta.')); }, 45000);
  script.src = 'https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js';
  script.onload = () => { clearTimeout(timeout); resolve(window.Vosk); };
  script.onerror = () => { clearTimeout(timeout); voskLibrary = null; script.remove(); reject(new Error('No se pudo descargar Vosk. Comprueba la conexión y reintenta.')); };
  document.head.appendChild(script);
});

export const transcribeVosk = async (audio, { signal, onProgress }) => {
  checkAbort(signal);
  let model, recognizer, cancel;
  const started = performance.now();
  try {
    const Vosk = await Promise.race([loadVoskLibrary(), new Promise((_, reject) => {
      cancel = () => reject(abortError()); signal.addEventListener('abort', cancel, { once: true });
    })]);
    checkAbort(signal);
    model = new Vosk.Model(new URL('/asr/vosk-model-small-es-0.42.tar.gz', location.href).href, -2);
    return await new Promise((resolve, reject) => {
      let processingStarted = 0, loadMs = 0;
      const finalTexts = [];
      const timeout = setTimeout(() => finish(new Error('Vosk está tardando demasiado. Puedes reintentar la misma muestra.')), 180000);
      const finish = (error, result) => {
        clearTimeout(timeout); signal.removeEventListener('abort', onAbort);
        if (error) reject(error); else resolve(result);
      };
      const onAbort = () => finish(abortError()); signal.addEventListener('abort', onAbort, { once: true });
      model.on('error', (message) => finish(new Error(message.error || 'No se pudo cargar Vosk.')));
      model.on('load', (message) => {
        if (signal.aborted) { finish(abortError()); return; }
        if (!message.result) { finish(new Error('No se pudo cargar Vosk.')); return; }
        try {
          loadMs = performance.now() - started; onProgress('Procesando la muestra…');
          recognizer = new model.KaldiRecognizer(SAMPLE_RATE);
          recognizer.on('error', (event) => finish(new Error(event.error || 'Error de Vosk.')));
          recognizer.on('result', (event) => {
            if (event.result?.text?.trim()) finalTexts.push(event.result.text.trim());
          });
          processingStarted = performance.now();
          // Feed one chunk per worker acknowledgement. This distinguishes a
          // normal segment from the requested final result, without a timer.
          let offset = 0, awaitingFinal = false;
          const feed = () => {
            if (signal.aborted) { finish(abortError()); return; }
            if (offset >= audio.length) { awaitingFinal = true; recognizer.retrieveFinalResult(); return; }
            const chunk = audio.slice(offset, offset + 4096); offset += chunk.length;
            recognizer.acceptWaveformFloat(chunk, SAMPLE_RATE);
          };
          recognizer.on('partialresult', () => { if (!awaitingFinal) feed(); });
          recognizer.on('result', () => {
            if (awaitingFinal) finish(null, { text: finalTexts.join(' '), loadMs, processingMs: performance.now() - processingStarted });
            else feed();
          });
          feed();
        } catch (error) { finish(error); }
      });
    });
  } finally {
    if (cancel) signal.removeEventListener('abort', cancel);
    recognizer?.remove(); model?.terminate();
  }
};

export const transcribeWhisper = (audio, { signal, language, context, onProgress }) => new Promise((resolve, reject) => {
  checkAbort(signal);
  const worker = new Worker(new URL(`/asr/whisper-comparison-worker.mjs?v=${APP_VERSION}`, location.href), { type: 'module' });
  let timeout;
  const finish = (error, result) => {
    clearTimeout(timeout); signal.removeEventListener('abort', cancel); worker.terminate();
    if (error) reject(error); else resolve(result);
  };
  const cancel = () => finish(abortError()); signal.addEventListener('abort', cancel, { once: true });
  timeout = setTimeout(() => finish(new Error('Whisper está tardando demasiado. Detén otras apps y reintenta la muestra.')), 240000);
  worker.onerror = (event) => finish(new Error(event.message || 'Safari no ha podido iniciar Whisper.'));
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') onProgress(data.progress == null ? 'Preparando Whisper…' : `Descargando modelo: ${Math.round(data.progress)} %`);
    if (data.type === 'processing') onProgress('Procesando la muestra…');
    if (data.type === 'error') finish(new Error(data.error));
    if (data.type === 'result') finish(null, { text: data.text, loadMs: data.loadMs, languageUsed: data.languageUsed, processingMs: data.processingMs,
      contextUsed: data.contextUsed, contextTermCount: data.contextTermCount, contextPrompt: data.contextPrompt });
  };
  worker.postMessage({ audio, language, context }, [audio.buffer]);
});

export const replayVosk = (audio, options) => replaySample({ audio, ...options,
  createRecognizer: async () => {
    checkAbort(options.signal);
    const Vosk = await abortable(loadVoskLibrary(), options.signal); checkAbort(options.signal);
    const model = new Vosk.Model(new URL('/asr/vosk-model-small-es-0.42.tar.gz', location.href).href, -2);
    let handle;
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => done(new Error('Vosk no se ha preparado a tiempo.')), 180000);
        const abort = () => done(abortError());
        const done = error => { clearTimeout(timeout); options.signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
        options.signal.addEventListener('abort', abort, { once: true });
        model.on('load', event => done(event.result ? null : new Error('No se pudo cargar Vosk.')));
        model.on('error', event => done(new Error(event.error || 'No se pudo cargar Vosk.')));
      });
      checkAbort(options.signal);
      handle = new model.KaldiRecognizer(SAMPLE_RATE);
      let pending = 0;
      // Each waveform has exactly one worker acknowledgement, final or partial.
      handle.on('result', () => { pending = Math.max(0, pending - 1); });
      handle.on('partialresult', () => { pending = Math.max(0, pending - 1); });
      return { recognizer: { on: handle.on.bind(handle),
        acceptWaveform: buffer => { pending++; handle.acceptWaveformFloat(buffer.getChannelData(0), SAMPLE_RATE); },
        remove: () => { handle.remove(); model.terminate(); } }, isIdle: () => !pending,
        details: () => ({ backend: 'wasm', languageUsed: 'spanish', contextUsed: false }) };
    } catch (error) { handle?.remove(); model.terminate(); throw error; }
  },
});

export const replayWhisper = (audio, options) => {
  let worker;
  return replaySample({ audio, ...options, createRecognizer: async threshold => {
    worker = new Worker(new URL(`/asr/whisper-live-worker.mjs?v=${APP_VERSION}`, location.href), { type: 'module' });
    const pending = new Map(); let id = 0, backend = 'wasm', timing = {}, processingMs = 0;
    const request = (data, onText) => new Promise((resolve, reject) => {
      checkAbort(options.signal);
      const key = ++id;
      const timeout = setTimeout(() => { pending.delete(key); reject(new Error('Whisper no ha respondido a tiempo.')); }, 180000);
      pending.set(key, { resolve, reject, timeout, onText });
      worker.postMessage({ ...data, id: key, session: 1 });
    });
    const fail = error => { for (const item of pending.values()) { clearTimeout(item.timeout); item.reject(error); } pending.clear(); };
    const abort = () => { fail(abortError()); worker.terminate(); };
    options.signal.addEventListener('abort', abort, { once: true });
    worker.onerror = event => fail(new Error(event.message || 'No se pudo iniciar Whisper.'));
    worker.onmessage = ({ data }) => {
      const item = pending.get(data.id); if (!item) return;
      if (data.encoderDevice) backend = data.encoderDevice;
      if (data.type === 'partial') { item.onText?.(data.text); return; }
      clearTimeout(item.timeout); pending.delete(data.id);
      if (data.type === 'error') { item.reject(new Error(data.error)); return; }
      if (data.type === 'result') {
        processingMs += data.processingMs || 0;
        if (data.text?.trim()) timing = { encoderDevice: data.encoderDevice, decoderDevice: data.decoderDevice, encoderDtype: data.encoderDtype,
          fallbackReason: data.fallbackReason, languageUsed: data.languageUsed, contextUsed: data.contextUsed,
          contextTermCount: data.contextTermCount, contextPrompt: data.contextPrompt };
      }
      item.resolve(data);
    };
    try {
      await request({ type: 'load' }); checkAbort(options.signal);
      const decoder = createWhisperStreamDecoder(SAMPLE_RATE, options.context,
        (pcm, context, onText) => request({ type: 'transcribe', audio: pcm, context, language: options.language }, onText),
        () => { options.signal.removeEventListener('abort', abort); fail(abortError()); worker.terminate(); },
        { getSchedulingDelay: () => backend === 'webgpu' ? 120 : 350, getSpeechThreshold: () => threshold });
      return { recognizer: decoder, isIdle: () => !pending.size,
        details: () => ({ backend, ...timing, processingMs }) };
    } catch (error) { options.signal.removeEventListener('abort', abort); fail(error); worker.terminate(); throw error; }
  } });
};
