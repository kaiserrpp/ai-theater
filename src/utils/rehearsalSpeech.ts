import { Platform } from 'react-native';
import * as Speech from 'expo-speech';

type SpeechCallbacks = {
  onStart?: () => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
};

type WindowWithSpeech = Window & typeof globalThis & {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
};

let activeStartWatchdog: ReturnType<typeof setTimeout> | null = null;
let activeRetryTimer: ReturnType<typeof setTimeout> | null = null;
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
  clearSpeechTimers();

  if (Platform.OS === 'web') {
    const synth = getSpeechSynthesisHandle();
    if (synth) {
      synth.cancel();
      return;
    }
  }

  void Speech.stop();
};

export const speakRehearsalSpeech = (text: string, callbacks: SpeechCallbacks) => {
  if (Platform.OS !== 'web') {
    Speech.speak(text, {
      language: 'es-ES',
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

  const attemptSpeak = (attempt: number) => {
    let started = false;
    const utterance = new Utterance(text);
    utterance.lang = 'es-ES';
    utterance.rate = 0.96;
    utterance.pitch = 1;
    utterance.volume = 1;

    const preferredVoice = getPreferredVoice(synth);
    if (preferredVoice) {
      utterance.voice = preferredVoice;
      utterance.lang = preferredVoice.lang || 'es-ES';
    }

    utterance.onstart = () => {
      started = true;
      clearSpeechTimers();
      callbacks.onStart?.();
    };

    utterance.onend = () => {
      clearSpeechTimers();
      callbacks.onDone?.();
    };

    utterance.onerror = () => {
      clearSpeechTimers();

      if (!started && attempt === 0) {
        activeRetryTimer = setTimeout(() => {
          attemptSpeak(1);
        }, 250);
        return;
      }

      callbacks.onError?.(new Error(started ? 'speech-playback-error' : 'speech-start-error'));
    };

    activeStartWatchdog = setTimeout(() => {
      if (started) {
        return;
      }

      synth.cancel();

      if (attempt === 0) {
        activeRetryTimer = setTimeout(() => {
          attemptSpeak(1);
        }, 250);
        return;
      }

      callbacks.onError?.(new Error('speech-start-timeout'));
    }, 1800);

    synth.cancel();
    synth.resume();
    synth.speak(utterance);
  };

  attemptSpeak(0);
};
