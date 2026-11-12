import { SAMPLE_RATE, checkAbort, abortError } from './comparison-core.mjs';
import { APP_VERSION } from './comparison-version.mjs';

let voskLibrary;
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
