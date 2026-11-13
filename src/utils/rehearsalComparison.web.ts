import { createRehearsalComparisonSession, type ComparisonNative } from './rehearsalComparisonSession';
import { getSharedVoskModel, preloadLocalSpeechRecognition } from './localSpeechRecognition';
import { createSharedWhisperRecognizer, preloadWhisperSpeechRecognition } from './whisperSpeechRecognition';
import { createFinalizableVoskRecognizer } from './finalizableVoskRecognizer';
import { needsNaturalRecognitionEnd } from './speechRecognitionCompatibility';
import { prepareRecognitionRestart } from './rehearsalSpeech';
import type { LocalRecognizer } from './localSpeechRecognitionSession';
import type { SpeechRecognitionHandle } from './speechRecognitionSession';
import { getNativePrototypeInfo } from './nativePrototype';

type SessionOptions = Pick<Parameters<typeof createRehearsalComparisonSession>[0], 'onChange' | 'onResult' | 'speechThreshold'>;
export const createBrowserRehearsalComparison = (options: SessionOptions) => {
  let nativeNeedsCue = false;
  let cancelNativePreparation: (() => void) | null = null;
  const session = createRehearsalComparisonSession({ ...options,
    prepare: async () => {
      const result = await Promise.allSettled([preloadLocalSpeechRecognition(), preloadWhisperSpeechRecognition()]);
      const errors: Partial<Record<'vosk' | 'whisper', string>> = {};
      result.forEach((item, i) => { if (item.status === 'rejected') errors[i ? 'whisper' : 'vosk'] = item.reason?.message || 'No se pudo preparar el modelo.'; });
      return errors;
    },
    prepareNative: () => !nativeNeedsCue || getNativePrototypeInfo() || !needsNaturalRecognitionEnd(navigator) ? Promise.resolve() : new Promise<void>((resolve, reject) => {
      const cancel = prepareRecognitionRestart({ onDone: () => { cancelNativePreparation = null; resolve(); }, onError: error => { cancelNativePreparation = null; reject(error); } });
      cancelNativePreparation = () => { cancel(); cancelNativePreparation = null; resolve(); };
    }),
    cancelPreparation: () => cancelNativePreparation?.(),
    openCapture: async (onFrame, onError, isCurrent) => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (!isCurrent()) { stream.getTracks().forEach(track => track.stop()); throw new Error('Captura cancelada.'); }
      let context: AudioContext;
      try { context = new AudioContext(); } catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
      let source: MediaStreamAudioSourceNode | null = null, processor: ScriptProcessorNode | null = null, output: GainNode | null = null, closed = false;
      const close = () => {
        if (closed) return; closed = true;
        if (processor) processor.onaudioprocess = null;
        source?.disconnect(); processor?.disconnect(); output?.disconnect();
        stream.getTracks().forEach(track => track.stop()); void context.close().catch(() => {});
      };
      try {
        await context.resume();
        const track = stream.getAudioTracks()[0];
        if (!track || track.readyState !== 'live' || track.muted) throw new Error('La captura compartida no está disponible para los motores locales.');
        track.addEventListener('mute', () => { if (!closed) onError('El navegador ha silenciado la captura compartida durante la escucha simultánea.'); });
        track.addEventListener('ended', () => { if (!closed) onError('El navegador ha cerrado la captura compartida.'); });
        source = context.createMediaStreamSource(stream); processor = context.createScriptProcessor(2048, 1, 1);
        output = context.createGain(); output.gain.value = 0;
        processor.onaudioprocess = event => { if (!closed) onFrame(event.inputBuffer); };
        source.connect(processor); processor.connect(output); output.connect(context.destination);
        return { sampleRate: context.sampleRate, close };
      } catch (error) { close(); throw error; }
    },
    createDecoder: async (engine, rate, turn, callbacks) => {
      let decoder: LocalRecognizer;
      if (engine === 'vosk') {
        const model = await getSharedVoskModel();
        const source = new model.KaldiRecognizer(rate) as LocalRecognizer & { retrieveFinalResult: () => void };
        decoder = createFinalizableVoskRecognizer(source, callbacks.finished);
      } else decoder = await createSharedWhisperRecognizer(rate, turn.context, options.speechThreshold,
        timing => { if (timing) callbacks.timing(timing); }, callbacks.finished);
      decoder.on('partialresult', event => callbacks.partial(event.result?.partial || ''));
      decoder.on('result', event => callbacks.final(event.result?.text || ''));
      decoder.on('error', event => callbacks.error(event.error || 'El motor no ha podido transcribir.'));
      return decoder;
    },
    openNative: (lang, callbacks): ComparisonNative => {
      const scoped = window as Window & { SpeechRecognition?: new () => SpeechRecognitionHandle; webkitSpeechRecognition?: new () => SpeechRecognitionHandle };
      const Constructor = scoped.SpeechRecognition || scoped.webkitSpeechRecognition;
      let recognition: SpeechRecognitionHandle | null = null, settled = false, ending = false;
      let resolveClosed: () => void = () => {}, timer: ReturnType<typeof setTimeout> | null = null;
      const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
      const natural = !getNativePrototypeInfo() && needsNaturalRecognitionEnd(navigator);
      const ended = () => { if (settled) return; settled = true; if (timer !== null) clearTimeout(timer); callbacks.ended(); resolveClosed(); };
      const abandon = () => {
        if (recognition) recognition.onresult = recognition.onend = recognition.onerror = recognition.onaudiostart = recognition.onspeechend = null;
        ended();
      };
      if (!Constructor) { callbacks.error('Este navegador no ofrece reconocimiento nativo.'); ended(); }
      else try {
        recognition = new Constructor(); recognition.lang = lang; recognition.continuous = !natural;
        recognition.interimResults = true; recognition.maxAlternatives = 1;
        recognition.onresult = event => {
          if (settled) return;
          callbacks.ready();
          const words: string[] = []; let final = true;
          for (let i = 0; i < event.results.length; i++) {
            const result = event.results[i], text = result?.[0]?.transcript?.trim();
            if (text) words.push(text); if (result && !result.isFinal) final = false;
          }
          callbacks.text(words.join(' '), final);
        };
        recognition.onaudiostart = () => { if (timer !== null) clearTimeout(timer); callbacks.ready(); };
        recognition.onspeechend = () => {};
        recognition.onerror = event => { if (!settled) { callbacks.error(`${event.error || 'Error nativo'}${event.message ? `: ${event.message}` : ''}`); callbacks.ready(); } };
        recognition.onend = ended;
        timer = setTimeout(() => { callbacks.error('Safari no ha confirmado entrada de audio en 10 s.'); callbacks.ready(); }, 10000);
        recognition.start(); nativeNeedsCue = true;
      } catch (error) { callbacks.error(error instanceof Error ? error.message : 'No se pudo iniciar el motor nativo.'); abandon(); }
      return { closed, abandon, finish: () => {
        if (ending || settled) return; ending = true;
        // The comparison is opt-in to simultaneous capture, not to poisoning
        // the native service with forced stops on iOS 27.
        if (!natural) try { (recognition as SpeechRecognitionHandle & { stop?: () => void })?.stop?.(); } catch {}
      } };
    },
  });
  return { ...session, notifyPlaybackEnd: () => { nativeNeedsCue = false; } };
};
