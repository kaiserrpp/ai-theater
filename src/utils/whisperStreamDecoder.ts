import type { LocalRecognizer } from './localSpeechRecognitionSession';
import type { ScriptRecognitionContext } from './scriptRecognitionContext';

export type WhisperAudioResult = { text: string };
type Transcribe = (audio: Float32Array, context: ScriptRecognitionContext | undefined, onText: (text: string) => void) => Promise<WhisperAudioResult>;
type Message = { result?: { text?: string; partial?: string }; error?: string };

export const createWhisperStreamDecoder = (sampleRate: number, context: ScriptRecognitionContext | (() => ScriptRecognitionContext | undefined) | undefined, transcribe: Transcribe, cancel: () => void, getSchedulingDelay: () => number = () => 350): LocalRecognizer => {
  const listeners: Partial<Record<'result' | 'partialresult' | 'error', (message: Message) => void>> = {};
  let frames: Float32Array[] = [], samples = 0, processed = 0, lastVoiced = 0;
  let lastText = '';
  let disposed = false, busy = false, timer: ReturnType<typeof setTimeout> | null = null;
  const remove = () => {
    if (disposed) return;
    disposed = true;
    if (timer !== null) clearTimeout(timer);
    frames = []; samples = 0; cancel();
  };
  const pump = async () => {
    timer = null;
    if (disposed || busy || lastVoiced <= processed || samples < sampleRate * 0.8) return;
    busy = true;
    const count = frames.length, length = samples;
    const pcm = new Float32Array(length);
    let offset = 0;
    frames.forEach((frame) => { pcm.set(frame, offset); offset += frame.length; });
    const ratio = sampleRate / 16000;
    const audio = new Float32Array(Math.floor(length / ratio));
    for (let i = 0; i < audio.length; i++) {
      const at = i * ratio, start = Math.floor(at), end = Math.min(pcm.length - 1, start + 1);
      audio[i] = pcm[start] + (pcm[end] - pcm[start]) * (at - start);
    }
    try {
      const result = await transcribe(audio, typeof context === 'function' ? context() : context, (text) => {
        if (disposed) return;
        // Words from this inference replace its previous partial; they never
        // commit an actor turn. The shared Intelligent matcher evaluates them.
        lastText = text;
        listeners.partialresult?.({ result: { partial: text } });
      });
      if (disposed) return;
      processed = length;
      if (length >= sampleRate * 20) {
        // Commit a bounded audio window, never a silence-based actor turn.
        // SpeechRecognitionSession still decides advancement from its words.
        frames = frames.slice(count); samples -= length;
        lastVoiced = Math.max(0, lastVoiced - length); processed = 0;
        lastText = '';
        listeners.result?.({ result: { text: result.text } });
      } else {
        lastText = result.text;
        listeners.partialresult?.({ result: { partial: result.text } });
      }
    } catch (error) {
      if (!disposed) {
        remove();
        listeners.error?.({ error: error instanceof Error ? error.message : 'No se pudo transcribir con Whisper.' });
      }
    } finally {
      busy = false;
      if (!disposed && lastVoiced > processed) schedule();
    }
  };
  const schedule = () => {
    if (!disposed && !busy && timer === null) timer = setTimeout(() => { void pump(); }, getSchedulingDelay());
  };
  return {
    on: (event, listener) => { listeners[event] = listener; },
    acceptWaveform: (buffer) => {
      if (disposed) return;
      const input = buffer.getChannelData(0).slice();
      // Keep pauses in the PCM, but don't start repeated neural work for
      // digital silence. This threshold never completes an actor's reply.
      const voiced = input.some((value) => Math.abs(value) > 0.0001);
      if (!samples && !voiced) return;
      if (voiced && !busy && lastText && processed >= lastVoiced && samples - lastVoiced >= sampleRate * 1.5) {
        // Only when speech resumes, retain the words already recognized and
        // start a fresh acoustic segment. A pause itself emits nothing and
        // never completes the actor's turn. This avoids asking Whisper to
        // decode a long silent gap between the two parts of one replica.
        const previous = lastText;
        frames = []; samples = processed = lastVoiced = 0; lastText = '';
        listeners.result?.({ result: { text: previous } });
        if (disposed) return;
      }
      frames.push(input); samples += input.length;
      if (voiced) lastVoiced = samples;
      if (samples >= sampleRate * 90) {
        remove(); listeners.error?.({ error: 'Whisper ha acumulado demasiado audio. Reintenta esta réplica.' }); return;
      }
      schedule();
    },
    remove,
  };
};
