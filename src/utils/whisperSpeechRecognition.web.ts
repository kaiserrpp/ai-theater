import Constants from 'expo-constants';
import { createLocalSpeechRecognitionConstructor, type LocalRecognizer, type LocalSpeechModel } from './localSpeechRecognitionSession';
import type { ScriptRecognitionContext } from './scriptRecognitionContext';
import type { RecognitionProcessingTiming } from '../types/sharedScript';
import { createWhisperStreamDecoder } from './whisperStreamDecoder';
import { createWhisperMicrophoneCheck } from './whisperMicrophoneCheck';

type Reply = { type: string; id: number; text: string; error?: string; processingMs?: number; queueMs?: number; audioDurationMs?: number;
  encoderDevice?: 'webgpu' | 'wasm'; decoderDevice?: 'wasm'; encoderDtype?: 'fp32' | 'q8'; fallbackReason?: string | null };
type OnTiming = (timing: RecognitionProcessingTiming | null) => void;
let worker: Worker | null = null, loaded: Promise<void> | null = null, nextId = 0;
let activeEncoderDevice: 'webgpu' | 'wasm' = 'wasm';
const pending = new Map<number, { session?: number; startedAt: number; onTiming?: OnTiming; onText?: (text: string) => void; timer: ReturnType<typeof setTimeout>; resolve: (reply: Reply) => void; reject: (error: Error) => void }>();
const rejectPending = (error: Error) => {
  pending.forEach((entry) => { clearTimeout(entry.timer); entry.reject(error); }); pending.clear();
};
const getWorker = () => {
  if (worker) return worker;
  activeEncoderDevice = 'wasm';
  const version = Constants.expoConfig?.version || '219';
  worker = new Worker(new URL(`/asr/whisper-live-worker.mjs?v=${version}`, window.location.href), { type: 'module' });
  const createdWorker = worker;
  worker.onmessage = ({ data }: MessageEvent<Reply>) => {
    if (worker !== createdWorker) return;
    const entry = pending.get(data.id); if (!entry) return;
    if (data.encoderDevice) activeEncoderDevice = data.encoderDevice;
    if (typeof data.processingMs === 'number' && data.text?.trim()) entry.onTiming?.({ kind: 'live_processing',
      requestToTextMs: Math.round(performance.now() - entry.startedAt), processingMs: Math.round(data.processingMs),
      queueMs: Math.round(data.queueMs || 0), audioDurationMs: Math.round(data.audioDurationMs || 0),
      ...(data.encoderDevice ? { encoderDevice: data.encoderDevice, decoderDevice: data.decoderDevice,
        encoderDtype: data.encoderDtype, fallbackReason: data.fallbackReason } : {}) });
    if (data.type === 'partial') { entry.onText?.(data.text); return; }
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
const request = (message: { type: string; session?: number; audio?: Float32Array; context?: ScriptRecognitionContext; language?: string }, onText?: (text: string) => void, onTiming?: OnTiming) => new Promise<Reply>((resolve, reject) => {
  const id = ++nextId;
  const timer = setTimeout(() => {
    pending.delete(id); reject(new Error('Whisper ha tardado demasiado. Comprueba la conexión y reintenta.'));
    worker?.terminate(); worker = null; loaded = null;
    rejectPending(new Error('Whisper ha terminado sin respuesta. Puedes reintentar.'));
  }, message.type === 'load' ? 120000 : 90000);
  pending.set(id, { session: message.session, startedAt: performance.now(), onTiming, onText, timer, resolve, reject });
  try { getWorker().postMessage({ ...message, id }, message.audio ? [message.audio.buffer as ArrayBuffer] : []); }
  catch (error) { clearTimeout(timer); pending.delete(id); reject(error instanceof Error ? error : new Error('Whisper no está disponible.')); }
});
const cancelSession = (session: number) => {
  worker?.postMessage({ type: 'cancel', session });
  for (const [id, entry] of pending) if (entry.session === session) {
    pending.delete(id); clearTimeout(entry.timer); entry.reject(new Error('Escucha cancelada.'));
  }
};
const prepareModel = (): Promise<void> => loaded ??= request({ type: 'load' }).then(() => undefined)
  .catch((error) => { loaded = null; throw error; });

const loadModel = async (getLanguage: () => string, onTiming: OnTiming | undefined, isMicrophoneCheck: () => boolean, getSpeechThreshold: () => number): Promise<LocalSpeechModel> => {
  await prepareModel();
  return {
    KaldiRecognizer: class implements LocalRecognizer {
      on: LocalRecognizer['on']; acceptWaveform: LocalRecognizer['acceptWaveform']; remove: LocalRecognizer['remove'];
      finishInput: LocalRecognizer['finishInput'];
      constructor(sampleRate: number, context?: () => ScriptRecognitionContext | undefined) {
        const session = ++nextId;
        let lastTiming: RecognitionProcessingTiming | null = null;
        const reportTiming: OnTiming = timing => { lastTiming = timing; onTiming?.(timing); };
        const decoder = isMicrophoneCheck() ? createWhisperMicrophoneCheck(sampleRate,
          async audio => {
            reportTiming(null);
            return request({ type: 'transcribe', session, audio, language: 'spanish' }, undefined, reportTiming);
          }, () => cancelSession(session)) : createWhisperStreamDecoder(sampleRate, context,
          async (audio, vocabulary, onText) => {
            // The displayed words still belong to the previous inference until
            // this one returns words. Keep their timing available for a skip.
            return request({ type: 'transcribe', session, audio, context: vocabulary, language: getLanguage() }, onText, reportTiming);
          },
          () => cancelSession(session), { getSchedulingDelay: () => activeEncoderDevice === 'webgpu' ? 120 : 350,
            getSpeechThreshold, onFinalized: info => { if (lastTiming) reportTiming({ ...lastTiming, ...info }); } });
        this.on = decoder.on; this.acceptWaveform = decoder.acceptWaveform; this.remove = decoder.remove;
        this.finishInput = decoder.finishInput;
      }
    },
  };
};

export const createSharedWhisperRecognizer = async (sampleRate: number, context: ScriptRecognitionContext,
  getSpeechThreshold: () => number, onTiming: OnTiming, onFinished: () => void): Promise<LocalRecognizer> => {
  await prepareModel(); const session = ++nextId;
  return createWhisperStreamDecoder(sampleRate, context,
    (audio, vocabulary, onText) => request({ type: 'transcribe', session, audio, context: vocabulary, language: 'auto' }, onText, onTiming),
    () => cancelSession(session), { getSchedulingDelay: () => activeEncoderDevice === 'webgpu' ? 120 : 350,
      getSpeechThreshold, allowFinishInput: true, onInputFinished: onFinished });
};

export const getWhisperSpeechRecognitionConstructor = (getContext: () => ScriptRecognitionContext | undefined, getLanguage: () => string = () => 'auto', onTiming?: OnTiming, isMicrophoneCheck: () => boolean = () => false, getSpeechThreshold: () => number = () => 0.0001) => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof Worker === 'undefined' ||
    typeof WebAssembly === 'undefined' || typeof window.AudioContext === 'undefined') return null;
  return createLocalSpeechRecognitionConstructor({ loadModel: () => loadModel(getLanguage, onTiming, isMicrophoneCheck, getSpeechThreshold), getContext,
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
    createAudioContext: () => new AudioContext(),
  });
};
export const preloadWhisperSpeechRecognition = async () => { await prepareModel(); };
export const disposeWhisperSpeechRecognition = () => {
  worker?.terminate(); worker = null; loaded = null;
  rejectPending(new Error('Whisper se ha cerrado.'));
};
