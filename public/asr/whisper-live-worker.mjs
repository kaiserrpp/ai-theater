import { loadWhisper, transcribeWhisperAudio } from './whisper-runtime.mjs';

let chain = Promise.resolve();
const cancelled = new Set();
self.onmessage = ({ data }) => {
  if (data.type === 'cancel') { cancelled.add(data.session); return; }
  chain = chain.catch(() => {}).then(async () => {
    if (cancelled.has(data.session)) return;
    try {
      if (data.type === 'load') { await loadWhisper(); self.postMessage({ type: 'ready', id: data.id }); return; }
      const result = await transcribeWhisperAudio(data.audio, { context: data.context, language: 'auto' });
      if (!cancelled.has(data.session)) self.postMessage({ type: 'result', id: data.id, ...result });
    } catch (error) {
      if (!cancelled.has(data.session)) self.postMessage({ type: 'error', id: data.id, error: error?.message || String(error) });
    }
    // Session identifiers are unique; keep cancellation bookkeeping bounded.
    if (cancelled.size > 100) cancelled.delete(cancelled.values().next().value);
  });
};
