import { createLocalSpeechRecognitionConstructor, type LocalSpeechModel } from './localSpeechRecognitionSession';
import type { SpeechRecognitionConstructor } from './speechRecognitionSession';

let loadedModel: Promise<LocalSpeechModel> | null = null;
const loadModel = () => {
  if (!loadedModel) {
    loadedModel = import('vosk-browser').then(({ Model }) => new Promise<LocalSpeechModel>((resolve, reject) => {
      const model = new Model(new URL('/asr/vosk-model-small-es-0.42.tar.gz', window.location.href).href, -2);
      const timeout = setTimeout(() => {
        model.terminate(); reject(new Error('La descarga del reconocimiento local ha tardado demasiado. Comprueba la conexión y reintenta.'));
      }, 120000);
      model.on('load', (message) => {
        clearTimeout(timeout);
        if (message.event === 'load' && message.result) resolve(model as unknown as LocalSpeechModel);
        else { model.terminate(); reject(new Error('No se ha podido cargar el reconocimiento local.')); }
      });
      model.on('error', (message) => {
        clearTimeout(timeout); loadedModel = null; model.terminate();
        reject(new Error(message.event === 'error' ? message.error : 'local-model-error'));
      });
    })).catch((error: unknown) => { loadedModel = null; throw error; });
  }
  return loadedModel;
};

const getAudioContext = () => typeof window === 'undefined' ? null :
  window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext || null;

let Constructor: SpeechRecognitionConstructor | null = null;
export const getLocalSpeechRecognitionConstructor = (): SpeechRecognitionConstructor | null => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia ||
      typeof Worker === 'undefined' || typeof WebAssembly === 'undefined' || !getAudioContext()) return null;
  Constructor ??= createLocalSpeechRecognitionConstructor({
    loadModel,
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    } }),
    createAudioContext: () => new (getAudioContext()!)(),
  });
  return Constructor;
};

export const preloadLocalSpeechRecognition = async (): Promise<void> => { await loadModel(); };
