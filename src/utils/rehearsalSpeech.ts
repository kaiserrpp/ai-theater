import * as Speech from 'expo-speech';
import { getSpeechOutputPlatform } from './speechOutputHelp';

type SpeechCallbacks = {
  onStart?: () => void;
  onDone?: () => void;
  onError?: (error: Error) => void;
  rate?: number;
  // Only the explicit speaker check needs a fresh engine, even when Safari
  // reports no queued speech. Ordinary rehearsal lines keep the warm engine.
  resetBeforeStart?: boolean;
};

type PreparedSpeech = {
  start: (rate?: number) => void;
  cancel: () => void;
};

type WindowWithSpeech = Window & typeof globalThis & {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
};

let activeSpeechWatchdog: ReturnType<typeof setTimeout> | null = null;
let activeRetryTimer: ReturnType<typeof setTimeout> | null = null;
let speechRun = 0;
let activeUtterance: SpeechSynthesisUtterance | null = null;
const detachUtterance = () => {
  if (!activeUtterance) return;
  activeUtterance.onstart = activeUtterance.onend = activeUtterance.onerror = null;
  activeUtterance = null;
};
const clearSpeechTimers = () => {
  if (activeSpeechWatchdog) {
    clearTimeout(activeSpeechWatchdog);
    activeSpeechWatchdog = null;
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

export const stopRehearsalSpeech = (forceReset = false) => {
  const hadUtterance = activeUtterance !== null;
  speechRun += 1;
  clearSpeechTimers();
  detachUtterance();

  if (typeof window !== 'undefined') {
    const synth = getSpeechSynthesisHandle();
    if (synth) {
      // Completed utterances already released their ownership. Resetting an
      // idle engine in every effect cleanup/start adds work between replicas.
      if (forceReset || hadUtterance || synth.pending || synth.speaking) synth.cancel();
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

  const createUtterance = (useSystemVoice = false) => {
    const utterance = new Utterance(text);
    utterance.lang = 'es-ES';
    utterance.rate = speechRate;
    utterance.pitch = 1;
    utterance.volume = 1;

    const preferredVoice = useSystemVoice ? null : getPreferredVoice(synth);
    if (preferredVoice) {
      utterance.voice = preferredVoice;
      utterance.lang = preferredVoice.lang || 'es-ES';
    }
    return utterance;
  };
  const preparedUtterance = callbacks.resetBeforeStart ? null : createUtterance();
  let notifiedStart = false;

  const attemptSpeak = (attempt: number) => {
    if (!isCurrent()) return;
    let started = false;
    const utterance = attempt === 0 && preparedUtterance ? preparedUtterance : createUtterance(attempt > 0 && getSpeechOutputPlatform() !== 'other');
    utterance.rate = speechRate;
    activeUtterance = utterance;
    const isCurrentAttempt = () => isCurrent() && activeUtterance === utterance;

    const recover = (error: Error) => {
      if (!isCurrentAttempt()) return;
      clearSpeechTimers();
      detachUtterance();
      try { synth.cancel(); }
      catch {
        finished = true;
        callbacks.onError?.(error);
        return;
      }
      if (attempt === 0) {
        activeRetryTimer = setTimeout(() => attemptSpeak(1), 250);
      } else {
        finished = true;
        callbacks.onError?.(error);
      }
    };

    utterance.onstart = () => {
      if (!isCurrentAttempt() || started) return;
      started = true;
      clearSpeechTimers();
      // Allow slow voices and long lines. A start event alone does not mean
      // that the synthesizer will eventually finish the utterance.
      const playbackTimeout = Math.max(4500, 2500 + text.length * 150 / Math.max(0.3, speechRate));
      activeSpeechWatchdog = setTimeout(() => recover(new Error('speech-playback-timeout')), playbackTimeout);
      if (!notifiedStart) {
        notifiedStart = true;
        callbacks.onStart?.();
      }
    };

    utterance.onend = () => {
      if (!isCurrentAttempt()) return;
      finished = true;
      clearSpeechTimers();
      detachUtterance();
      callbacks.onDone?.();
    };

    utterance.onerror = (event) => {
      const failure = event as { error?: string; message?: string } | undefined;
      const detail = failure?.message?.trim() || failure?.error?.trim();
      recover(new Error(detail || (started ? 'speech-playback-error' : 'speech-start-error')));
    };

    activeSpeechWatchdog = setTimeout(() => recover(new Error('speech-start-timeout')), 1800);
    try {
      synth.resume();
      synth.speak(utterance);
    } catch (error) {
      recover(error instanceof Error ? error : new Error('speech-start-error'));
    }
  };

  return {
    start: (rate = speechRate) => {
      if (launched || cancelled) return;
      speechRate = rate;
      stopRehearsalSpeech(callbacks.resetBeforeStart);
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
