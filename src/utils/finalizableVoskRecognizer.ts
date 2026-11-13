import type { LocalRecognizer } from './localSpeechRecognitionSession';

// Vosk acknowledges each audio frame. Drain those acknowledgements before
// requesting its explicit final result, so a segment result cannot be mistaken
// for the end of a whole comparison take.
export const createFinalizableVoskRecognizer = (source: LocalRecognizer & { retrieveFinalResult: () => void }, onFinished: () => void): LocalRecognizer => {
  const listeners: Partial<Record<'result' | 'partialresult' | 'error', Parameters<LocalRecognizer['on']>[1]>> = {};
  let pending = 0, finishing = false, requested = false, disposed = false;
  const drain = () => { if (!disposed && finishing && !pending && !requested) { requested = true; source.retrieveFinalResult(); } };
  source.on('partialresult', event => { if (disposed) return; pending = Math.max(0, pending - 1); listeners.partialresult?.(event); drain(); });
  source.on('result', event => {
    if (disposed) return;
    if (!requested) pending = Math.max(0, pending - 1);
    listeners.result?.(event);
    if (requested) onFinished(); else drain();
  });
  source.on('error', event => { if (!disposed) listeners.error?.(event); });
  return { on: (event, callback) => { listeners[event] = callback; },
    acceptWaveform: buffer => { if (!disposed && !finishing) { pending++; source.acceptWaveform(buffer); } },
    finishInput: () => { if (disposed || finishing) return false; finishing = true; drain(); return true; },
    remove: () => { disposed = true; source.remove(); },
  };
};
