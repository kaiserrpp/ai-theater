import type { LocalRecognizer } from './localSpeechRecognitionSession';

// A setup check is one explicit recording, never a growing rehearsal window.
// The caller releases capture before asking this decoder to transcribe it.
export const createWhisperMicrophoneCheck = (
  sampleRate: number,
  transcribe: (audio: Float32Array) => Promise<{ text: string }>,
  cancel: () => void,
): LocalRecognizer => {
  const listeners: Partial<Record<'result' | 'partialresult' | 'error', Parameters<LocalRecognizer['on']>[1]>> = {};
  let frames: Float32Array[] = [], samples = 0, disposed = false, finished = false;
  const remove = () => {
    if (disposed) return;
    disposed = true; frames = []; cancel();
  };
  const fail = (error: string) => {
    if (disposed) return;
    remove(); listeners.error?.({ error });
  };
  return {
    on: (event, listener) => { listeners[event] = listener; },
    acceptWaveform: buffer => {
      if (disposed || finished) return;
      const input = buffer.getChannelData(0).slice();
      frames.push(input); samples += input.length;
      if (samples > sampleRate * 30) fail('La grabación de prueba ha llegado a 30 segundos. Pulsa Reintentar prueba y di la frase una vez.');
    },
    finishInput: () => {
      if (disposed || finished) return false;
      finished = true;
      const pcm = new Float32Array(samples);
      let offset = 0;
      for (const frame of frames) { pcm.set(frame, offset); offset += frame.length; }
      frames = [];
      if (samples < sampleRate * 0.4 || !pcm.some(value => Math.abs(value) > 0.0001)) {
        fail('No hemos recibido suficiente voz. Pulsa Reintentar prueba y di la frase antes de terminar.');
        return false;
      }
      const ratio = sampleRate / 16000;
      const audio = new Float32Array(Math.floor(pcm.length / ratio));
      for (let i = 0; i < audio.length; i++) {
        const at = i * ratio, left = Math.floor(at), right = Math.min(pcm.length - 1, left + 1);
        audio[i] = pcm[left] + (pcm[right] - pcm[left]) * (at - left);
      }
      void transcribe(audio).then(result => {
        if (!disposed) listeners.result?.({ result: { text: result.text } });
      }).catch(error => fail(error instanceof Error ? error.message : 'No se pudo comprobar la frase con Whisper.'));
      return true;
    },
    remove,
  };
};
