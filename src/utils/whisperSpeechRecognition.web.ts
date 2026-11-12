import Constants from 'expo-constants';
import { createLocalSpeechRecognitionConstructor, type LocalRecognizer, type LocalSpeechModel } from './localSpeechRecognitionSession';
import type { ScriptRecognitionContext } from './scriptRecognitionContext';
import { createWhisperStreamDecoder } from './whisperStreamDecoder';

type Reply = { type: string; id: number; text: string; error?: string };
let worker: Worker | null = null, loaded: Promise<LocalSpeechModel> | null = null, nextId = 0;
const pending = new Map<number, { session?: number; timer: ReturnType<typeof setTimeout>; resolve: (reply: Reply) => void; reject: (error: Error) => void }>();
const rejectPending = (error: Error) => {
  pending.forEach((entry) => { clearTimeout(entry.timer); entry.reject(error); }); pending.clear();
};
const getWorker = () => {
  if (worker) return worker;
  const version = Constants.expoConfig?.version || '214';
  worker = new Worker(new URL(`/asr/whisper-live-worker.mjs?v=${version}`, window.location.href), { type: 'module' });
  const createdWorker = worker;
  worker.onmessage = ({ data }: MessageEvent<Reply>) => {
    if (worker !== createdWorker) return;
    const entry = pending.get(data.id); if (!entry) return;
    pending.delete(data.id); clearTimeout(entry.timer);
    if (data.type === 'error') entry.reject(new Error(data.error || 'Whisper no ha podido transcribir.'));
    else entry.resolve(data);
  };
  worker.onerror = (event) => {
    if (worker !== createdWorker) return;
    worker?.terminate(); worker = null; loaded = null;
    rejectPending(new Error(event.message || 'No se pudo iniciar Whisper en este dispositivo.'));
  };
  return worker;
};
const request = (message: { type: string; session?: number; audio?: Float32Array; context?: ScriptRecognitionContext }) => new Promise<Reply>((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => {
    pending.delete(id); reject(new Error('Whisper ha tardado demasiado. Comprueba la conexión y reintenta.'));
    worker?.terminate(); worker = null; loaded = null;
    rejectPending(new Error('Whisper ha terminado sin respuesta. Puedes reintentar.'));
  }, message.type === 'load' ? 120000 : 90000);
  pending.set(id, { session: message.session, timer, resolve, reject });
  try { getWorker().postMessage({ ...message, id }, message.audio ? [message.audio.buffer as ArrayBuffer] : []); }
  catch (error) { clearTimeout(timer); pending.delete(id); reject(error instanceof Error ? error : new Error('Whisper no está disponible.')); }
});
const cancelSession = (session: number) => {
  worker?.postMessage({ type: 'cancel', session });
  for (const [id, entry] of pending) if (entry.session === session) {
    pending.delete(id); clearTimeout(entry.timer); entry.reject(new Error('Escucha cancelada.'));
  }
};
const loadModel = (): Promise<LocalSpeechModel> => loaded ??= request({ type: 'load' }).then(() => ({
  KaldiRecognizer: class implements LocalRecognizer {
    on: LocalRecognizer['on']; acceptWaveform: LocalRecognizer['acceptWaveform']; remove: LocalRecognizer['remove'];
    constructor(sampleRate: number, context?: () => ScriptRecognitionContext | undefined) {
      const session = ++nextId;
      const decoder = createWhisperStreamDecoder(sampleRate, context,
        async (audio, vocabulary) => request({ type: 'transcribe', session, audio, context: vocabulary }),
        () => cancelSession(session));
      this.on = decoder.on; this.acceptWaveform = decoder.acceptWaveform; this.remove = decoder.remove;
    }
  },
})).catch((error) => { loaded = null; throw error; });

export const getWhisperSpeechRecognitionConstructor = (getContext: () => ScriptRecognitionContext | undefined) => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof Worker === 'undefined' ||
    typeof WebAssembly === 'undefined' || typeof window.AudioContext === 'undefined') return null;
  return createLocalSpeechRecognitionConstructor({ loadModel, getContext,
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
    createAudioContext: () => new AudioContext(),
  });
};
export const preloadWhisperSpeechRecognition = async () => { await loadModel(); };
export const disposeWhisperSpeechRecognition = () => {
  worker?.terminate(); worker = null; loaded = null;
  rejectPending(new Error('Whisper se ha cerrado.'));
};
