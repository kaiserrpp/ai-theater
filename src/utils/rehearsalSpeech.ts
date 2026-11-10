import * as Speech from 'expo-speech';

type SpeechCallbacks = {
  onStart?: () => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
  rate?: number;
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
  speechRun += 1;
  clearSpeechTimers();
  detachUtterance();

  if (typeof window !== 'undefined') {
    const synth = getSpeechSynthesisHandle();
    if (synth) {
      synth.cancel();
      return;
    }
  }

  void Speech.stop();
};

export const speakRehearsalSpeech = (text: string, callbacks: SpeechCallbacks) => {
  const speechRate = callbacks.rate ?? 0.96;

  if (typeof window === 'undefined') {
    Speech.speak(text, {
      language: 'es-ES',
      rate: speechRate,
      onStart: callbacks.onStart,
      onDone: callbacks.onDone,
      onError: (error) => callbacks.onError?.(error instanceof Error ? error : new Error('speech-error')),
    });
    return;
  }

  const synth = getSpeechSynthesisHandle();
  const Utterance = getUtteranceConstructor();

  if (!synth || !Utterance) {
    callbacks.onError?.(new Error('speech-synthesis-unavailable'));
    return;
  }

  stopRehearsalSpeech();
  const run = speechRun;
  let finished = false;
  const isCurrent = () => speechRun === run && !finished;

  const attemptSpeak = (attempt: number) => {
    if (!isCurrent()) return;
    let started = false;
    const utterance = new Utterance(text);
    activeUtterance = utterance;
    utterance.lang = 'es-ES';
    utterance.rate = speechRate;
    utterance.pitch = 1;
    utterance.volume = 1;

    const preferredVoice = getPreferredVoice(synth);
    if (preferredVoice) {
      utterance.voice = preferredVoice;
      utterance.lang = preferredVoice.lang || 'es-ES';
    }

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

    synth.cancel();
    synth.resume();
    synth.speak(utterance);
  };

  attemptSpeak(0);
};

export const prepareRecognitionRestart = (callbacks: { onDone: () => void; onError: (error: Error) => void }) => {
  speakRehearsalSpeech('Te escucho.', callbacks);
  const cueRun = speechRun;
  return () => { if (speechRun === cueRun) stopRehearsalSpeech(); };
};
