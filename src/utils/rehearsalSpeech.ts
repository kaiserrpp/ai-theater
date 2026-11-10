import * as Speech from 'expo-speech';

type SpeechCallbacks = {
  onStart?: () => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
  rate?: number;
};

type PreparedSpeech = {
  start: (rate?: number) => void;
  cancel: () => void;
};

type WindowWithSpeech = Window & typeof globalThis & {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
};

let activeStartWatchdog: ReturnType<typeof setTimeout> | null = null;
let activeRetryTimer: ReturnType<typeof setTimeout> | null = null;
let speechRun = 0;
let activeUtterance: SpeechSynthesisUtterance | null = null;
const detachUtterance = () => {
  if (!activeUtterance) return;
  activeUtterance.onstart = activeUtterance.onend = activeUtterance.onerror = null;
  activeUtterance = null;
};
const clearSpeechTimers = () => {
  if (activeStartWatchdog) {
    clearTimeout(activeStartWatchdog);
    activeStartWatchdog = null;
  }

  if (activeRetryTimer) {
    clearTimeout(activeRetryTimer);
    activeRetryTimer = null;
  }
};

const getSpeechSynthesisHandle = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const scopedWindow = window as WindowWithSpeech;
  return scopedWindow.speechSynthesis ?? null;
};

const getUtteranceConstructor = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const scopedWindow = window as WindowWithSpeech;
  return scopedWindow.SpeechSynthesisUtterance ?? null;
};

const getPreferredVoice = (synth: SpeechSynthesis) => {
  const voices = synth.getVoices();
  if (!voices.length) {
    return null;
  }

  return (
    voices.find((voice) => voice.lang?.toLowerCase().startsWith('es-es')) ??
    voices.find((voice) => voice.lang?.toLowerCase().startsWith('es')) ??
    voices.find((voice) => voice.default) ??
    voices[0]
  );
};

export const stopRehearsalSpeech = () => {
  const hadUtterance = activeUtterance !== null;
  speechRun += 1;
  clearSpeechTimers();
  detachUtterance();

  if (typeof window !== 'undefined') {
    const synth = getSpeechSynthesisHandle();
    if (synth) {
      // Completed utterances already released their ownership. Resetting an
      // idle engine in every effect cleanup/start adds work between replicas.
      if (hadUtterance || synth.pending || synth.speaking) synth.cancel();
      return;
    }
  }

  void Speech.stop();
};

// Construct/select the voice while recognition is closing, without playing
// anything or touching its audio session. start() is called only after input
// has ended; calibration can still call the wrapper directly in its tap.
export const prepareRehearsalSpeech = (text: string, callbacks: SpeechCallbacks): PreparedSpeech => {
  let speechRate = callbacks.rate ?? 0.96;
  let launched = false;
  let finished = false;
  let cancelled = false;
  let run: number | null = null;

  if (typeof window === 'undefined') {
    return {
      start: (rate = speechRate) => {
        if (launched || cancelled) return;
        run = ++speechRun;
        launched = true;
        Speech.speak(text, {
          language: 'es-ES', rate,
          onStart: () => { if (!cancelled && speechRun === run) callbacks.onStart?.(); },
          onDone: () => { finished = true; if (!cancelled && speechRun === run) callbacks.onDone?.(); },
          onError: (error) => {
            finished = true;
            if (!cancelled && speechRun === run) callbacks.onError?.(error instanceof Error ? error : new Error('speech-error'));
          },
        });
      },
      cancel: () => { cancelled = true; if (launched && !finished && speechRun === run) stopRehearsalSpeech(); },
    };
  }

  const synth = getSpeechSynthesisHandle();
  const Utterance = getUtteranceConstructor();

  if (!synth || !Utterance) {
    return {
      start: () => {
        if (launched || cancelled) return;
        launched = true;
        callbacks.onError?.(new Error('speech-synthesis-unavailable'));
      },
      cancel: () => { cancelled = true; },
    };
  }

  const isCurrent = () => launched && speechRun === run && !finished && !cancelled;

  const createUtterance = () => {
    const utterance = new Utterance(text);
    utterance.lang = 'es-ES';
    utterance.rate = speechRate;
    utterance.pitch = 1;
    utterance.volume = 1;

    const preferredVoice = getPreferredVoice(synth);
    if (preferredVoice) {
      utterance.voice = preferredVoice;
      utterance.lang = preferredVoice.lang || 'es-ES';
    }
    return utterance;
  };
  const preparedUtterance = createUtterance();

  const attemptSpeak = (attempt: number) => {
    if (!isCurrent()) return;
    let started = false;
    const utterance = attempt === 0 ? preparedUtterance : createUtterance();
    utterance.rate = speechRate;
    activeUtterance = utterance;

    utterance.onstart = () => {
      if (!isCurrent()) return;
      started = true;
      clearSpeechTimers();
      callbacks.onStart?.();
    };

    utterance.onend = () => {
      if (!isCurrent()) return;
      finished = true;
      clearSpeechTimers();
      detachUtterance();
      callbacks.onDone?.();
    };

    utterance.onerror = () => {
      if (!isCurrent()) return;
      clearSpeechTimers();
      detachUtterance();

      if (!started && attempt === 0) {
        activeRetryTimer = setTimeout(() => {
          attemptSpeak(1);
        }, 250);
        return;
      }

      finished = true;
      callbacks.onError?.(new Error(started ? 'speech-playback-error' : 'speech-start-error'));
    };

    activeStartWatchdog = setTimeout(() => {
      if (!isCurrent() || started) {
        return;
      }

      clearSpeechTimers();
      detachUtterance();
      synth.cancel();

      if (attempt === 0) {
        activeRetryTimer = setTimeout(() => {
          attemptSpeak(1);
        }, 250);
        return;
      }

      finished = true;
      callbacks.onError?.(new Error('speech-start-timeout'));
    }, 1800);

    synth.resume();
    synth.speak(utterance);
  };

  return {
    start: (rate = speechRate) => {
      if (launched || cancelled) return;
      speechRate = rate;
      stopRehearsalSpeech();
      run = speechRun;
      launched = true;
      attemptSpeak(0);
    },
    cancel: () => {
      cancelled = true;
      if (launched && speechRun === run) stopRehearsalSpeech();
    },
  };
};

export const speakRehearsalSpeech = (text: string, callbacks: SpeechCallbacks) =>
  prepareRehearsalSpeech(text, callbacks).start();

export const prepareRecognitionRestart = (callbacks: { onDone: () => void; onError: (error: Error) => void }) => {
  speakRehearsalSpeech('Te escucho.', callbacks);
  const cueRun = speechRun;
  return () => { if (speechRun === cueRun) stopRehearsalSpeech(); };
};
