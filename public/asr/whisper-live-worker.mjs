import { loadLiveWhisper, transcribeWhisperLiveAudio } from './whisper-live-runtime.mjs';

let chain = Promise.resolve();
const cancelled = new Set();
self.onmessage = ({ data }) => {
  if (data.type === 'cancel') { cancelled.add(data.session); return; }
  const queuedAt = performance.now();
  chain = chain.catch(() => {}).then(async () => {
    if (cancelled.has(data.session)) return;
    try {
      if (data.type === 'load') {
        const runtime = await loadLiveWhisper();
        self.postMessage({ type: 'ready', id: data.id, encoderDevice: runtime.encoderDevice }); return;
      }
      const timing = { queueMs: performance.now() - queuedAt, audioDurationMs: data.audio.length / 16 };
      const result = await transcribeWhisperLiveAudio(data.audio, {
        context: data.context, language: data.language || 'auto', isCancelled: () => cancelled.has(data.session),
        onText: (text, progress) => {
          if (!cancelled.has(data.session)) self.postMessage({ type: 'partial', id: data.id, text, ...timing, ...progress });
        },
      });
      if (!cancelled.has(data.session)) self.postMessage({ type: 'result', id: data.id, ...timing, ...result });
    } catch (error) {
      if (!cancelled.has(data.session)) self.postMessage({ type: 'error', id: data.id, error: error?.message || String(error) });
    }
    // Session identifiers are unique; keep cancellation bookkeeping bounded.
    if (cancelled.size > 100) cancelled.delete(cancelled.values().next().value);
  });
};
