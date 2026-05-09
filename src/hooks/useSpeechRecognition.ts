import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type SpeechRecognitionStatus = 'unsupported' | 'idle' | 'listening' | 'error';

type SpeechRecognitionAlternativeLike = {
  transcript: string;
  confidence?: number;
};

type SpeechRecognitionResultLike = {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: SpeechRecognitionAlternativeLike | undefined;
};

type SpeechRecognitionResultListLike = {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike | undefined;
};

type SpeechRecognitionEventLike = Event & {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
};

type SpeechRecognitionErrorEventLike = Event & {
  readonly error?: string;
  readonly message?: string;
};

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type WindowWithSpeechRecognition = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

type UseSpeechRecognitionOptions = {
  enabled: boolean;
  lang: string;
  lineKey: string | null;
};

const getSpeechRecognitionConstructor = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const scopedWindow = window as WindowWithSpeechRecognition;
  return scopedWindow.SpeechRecognition ?? scopedWindow.webkitSpeechRecognition ?? null;
};

export const useSpeechRecognition = ({
  enabled,
  lang,
  lineKey,
}: UseSpeechRecognitionOptions) => {
  const SpeechRecognitionConstructor = useMemo(getSpeechRecognitionConstructor, []);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldListenRef = useRef(false);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef('');
  const committedTranscriptRef = useRef('');
  const [status, setStatus] = useState<SpeechRecognitionStatus>(
    SpeechRecognitionConstructor ? 'idle' : 'unsupported'
  );
  const [transcript, setTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isSupported = Boolean(SpeechRecognitionConstructor);

  const clearRestartTimeout = useCallback(() => {
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
  }, []);

  const stopRecognition = useCallback(() => {
    shouldListenRef.current = false;
    clearRestartTimeout();

    const recognition = recognitionRef.current;
    if (!recognition) {
      return;
    }

    try {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      recognition.onstart = null;
      recognition.abort();
    } catch {
      // Some browsers throw if recognition is already stopped.
    }

    recognitionRef.current = null;
    setStatus(isSupported ? 'idle' : 'unsupported');
  }, [clearRestartTimeout, isSupported]);

  const resetTranscript = useCallback(() => {
    transcriptRef.current = '';
    committedTranscriptRef.current = '';
    setTranscript('');
    setFinalTranscript('');
    setInterimTranscript('');
    setError(null);
  }, []);

  const startRecognition = useCallback(() => {
    if (!SpeechRecognitionConstructor) {
      setStatus('unsupported');
      return;
    }

    clearRestartTimeout();
    shouldListenRef.current = true;

    const recognition = new SpeechRecognitionConstructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setStatus('listening');
      setError(null);
    };
    recognition.onerror = (event) => {
      const errorMessage = event.message || event.error || 'No se pudo reconocer la voz.';
      setError(errorMessage);
      setStatus('error');

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        shouldListenRef.current = false;
      }
    };
    recognition.onresult = (event) => {
      let sessionTranscript = '';
      let nextFinalTranscript = '';
      let nextInterimTranscript = '';

      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const alternative = result?.[0];
        const text = alternative?.transcript?.trim();

        if (!text) {
          continue;
        }

        sessionTranscript = `${sessionTranscript} ${text}`.trim();

        if (result?.isFinal) {
          nextFinalTranscript = `${nextFinalTranscript} ${text}`.trim();
        } else {
          nextInterimTranscript = `${nextInterimTranscript} ${text}`.trim();
        }
      }

      const nextTranscript = [committedTranscriptRef.current, sessionTranscript]
        .filter(Boolean)
        .join(' ')
        .trim();
      transcriptRef.current = nextTranscript;
      setTranscript(nextTranscript);
      setFinalTranscript(nextFinalTranscript);
      setInterimTranscript(nextInterimTranscript);
    };
    recognition.onend = () => {
      committedTranscriptRef.current = transcriptRef.current;
      recognitionRef.current = null;

      if (!shouldListenRef.current) {
        setStatus(isSupported ? 'idle' : 'unsupported');
        return;
      }

      restartTimeoutRef.current = setTimeout(() => {
        restartTimeoutRef.current = null;

        if (shouldListenRef.current) {
          startRecognition();
        }
      }, 250);
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch (startError) {
      const errorMessage =
        startError instanceof Error ? startError.message : 'No se pudo iniciar el reconocimiento.';
      setError(errorMessage);
      setStatus('error');
    }
  }, [SpeechRecognitionConstructor, clearRestartTimeout, isSupported, lang]);

  const restartRecognition = useCallback(() => {
    stopRecognition();
    resetTranscript();

    setTimeout(() => {
      if (shouldListenRef.current || enabled) {
        startRecognition();
      }
    }, 120);
  }, [enabled, resetTranscript, startRecognition, stopRecognition]);

  useEffect(() => {
    resetTranscript();

    if (!enabled || !lineKey) {
      stopRecognition();
      return;
    }

    startRecognition();

    return () => {
      stopRecognition();
    };
  }, [enabled, lineKey, resetTranscript, startRecognition, stopRecognition]);

  useEffect(
    () => () => {
      stopRecognition();
    },
    [stopRecognition]
  );

  return {
    isSupported,
    status,
    transcript,
    finalTranscript,
    interimTranscript,
    error,
    resetTranscript,
    restartRecognition,
    stopRecognition,
  };
};
