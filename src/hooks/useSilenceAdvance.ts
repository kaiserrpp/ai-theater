import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ListeningStatus = 'unsupported' | 'idle' | 'requesting' | 'active' | 'error';

interface UseSilenceAdvanceOptions {
  enabledForCurrentLine: boolean;
  lineKey: string | null;
  onSilenceDetected: () => void;
}

interface UseSilenceAdvanceResult {
  listeningStatus: ListeningStatus;
  listeningError: string | null;
  isListeningActive: boolean;
  isListeningSupported: boolean;
  signalLevel: number;
  rawLevel: number;
  hasSpeechStarted: boolean;
  isSignalAboveThreshold: boolean;
  silenceElapsedMs: number;
  voiceThreshold: number;
  lineStateLabel: string;
  startListening: () => Promise<void>;
  stopListening: () => void;
}

const MIN_VOICE_THRESHOLD = 0.01;
const THRESHOLD_MULTIPLIER = 2.1;
const THRESHOLD_RELEASE_FACTOR = 0.78;
const SILENCE_MS = 1000;
const LINE_GRACE_MS = 350;
const MIN_SPEECH_MS = 160;
const SPEECH_GAP_TOLERANCE_MS = 220;

type WindowWithWebkitAudioContext = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

const getAudioContextConstructor = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const scopedWindow = window as WindowWithWebkitAudioContext;
  return scopedWindow.AudioContext ?? scopedWindow.webkitAudioContext ?? null;
};

const isListeningSupportedOnDevice = () =>
  typeof navigator !== 'undefined' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function' &&
  Boolean(getAudioContextConstructor());

const resetLineTracking = (
  hasDetectedVoiceRef: React.MutableRefObject<boolean>,
  lastVoiceTimestampRef: React.MutableRefObject<number>,
  silenceHandledRef: React.MutableRefObject<boolean>,
  speechStartRef: React.MutableRefObject<number>,
  lineStartedAtRef: React.MutableRefObject<number>
) => {
  hasDetectedVoiceRef.current = false;
  lastVoiceTimestampRef.current = 0;
  silenceHandledRef.current = false;
  speechStartRef.current = 0;
  lineStartedAtRef.current = 0;
};

export const useSilenceAdvance = ({
  enabledForCurrentLine,
  lineKey,
  onSilenceDetected,
}: UseSilenceAdvanceOptions): UseSilenceAdvanceResult => {
  const onSilenceDetectedRef = useRef(onSilenceDetected);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const samplesRef = useRef<Uint8Array | null>(null);
  const hasDetectedVoiceRef = useRef(false);
  const lastVoiceTimestampRef = useRef(0);
  const silenceHandledRef = useRef(false);
  const speechStartRef = useRef(0);
  const lineStartedAtRef = useRef(0);
  const lastUiUpdateRef = useRef(0);
  const noiseFloorRef = useRef(0.004);

  const isListeningSupported = useMemo(isListeningSupportedOnDevice, []);
  const [listeningStatus, setListeningStatus] = useState<ListeningStatus>(
    isListeningSupported ? 'idle' : 'unsupported'
  );
  const [listeningError, setListeningError] = useState<string | null>(null);
  const [signalLevel, setSignalLevel] = useState(0);
  const [rawLevel, setRawLevel] = useState(0);
  const [hasSpeechStarted, setHasSpeechStarted] = useState(false);
  const [isSignalAboveThreshold, setIsSignalAboveThreshold] = useState(false);
  const [silenceElapsedMs, setSilenceElapsedMs] = useState(0);
  const [voiceThreshold, setVoiceThreshold] = useState(MIN_VOICE_THRESHOLD);
  const [lineStateLabel, setLineStateLabel] = useState('preparando linea');

  onSilenceDetectedRef.current = onSilenceDetected;

  const stopListening = useCallback(() => {
    if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }

    samplesRef.current = null;
    resetLineTracking(
      hasDetectedVoiceRef,
      lastVoiceTimestampRef,
      silenceHandledRef,
      speechStartRef,
      lineStartedAtRef
    );
    lastUiUpdateRef.current = 0;
    setListeningStatus(isListeningSupported ? 'idle' : 'unsupported');
    setListeningError(null);
    setSignalLevel(0);
    setRawLevel(0);
    setHasSpeechStarted(false);
    setIsSignalAboveThreshold(false);
    setSilenceElapsedMs(0);
    setVoiceThreshold(MIN_VOICE_THRESHOLD);
    setLineStateLabel('preparando linea');
  }, [isListeningSupported]);

  useEffect(() => () => {
    stopListening();
  }, [stopListening]);

  useEffect(() => {
    resetLineTracking(
      hasDetectedVoiceRef,
      lastVoiceTimestampRef,
      silenceHandledRef,
      speechStartRef,
      lineStartedAtRef
    );
    setSignalLevel(0);
    setRawLevel(0);
    setHasSpeechStarted(false);
    setIsSignalAboveThreshold(false);
    setSilenceElapsedMs(0);
    setLineStateLabel('preparando linea');
  }, [lineKey]);

  useEffect(() => {
    if (!enabledForCurrentLine) {
      resetLineTracking(
        hasDetectedVoiceRef,
        lastVoiceTimestampRef,
        silenceHandledRef,
        speechStartRef,
        lineStartedAtRef
      );
      setSignalLevel(0);
      setRawLevel(0);
      setHasSpeechStarted(false);
      setIsSignalAboveThreshold(false);
      setSilenceElapsedMs(0);
      setLineStateLabel('preparando linea');
    }
  }, [enabledForCurrentLine]);

  const monitorSignal = useCallback(() => {
    const analyser = analyserRef.current;
    const samples = samplesRef.current;

    if (!analyser || !samples || typeof requestAnimationFrame !== 'function') {
      return;
    }

    analyser.getByteTimeDomainData(samples as unknown as Uint8Array<ArrayBuffer>);
    let sumSquares = 0;

    for (let index = 0; index < samples.length; index += 1) {
      const normalizedSample = (samples[index] - 128) / 128;
      sumSquares += normalizedSample * normalizedSample;
    }

    const rms = Math.sqrt(sumSquares / samples.length);
    const adaptiveThreshold = Math.max(MIN_VOICE_THRESHOLD, noiseFloorRef.current * THRESHOLD_MULTIPLIER);
    const releaseThreshold = adaptiveThreshold * THRESHOLD_RELEASE_FACTOR;
    const isAboveThreshold = rms >= adaptiveThreshold;
    const now =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

    if (!isAboveThreshold) {
      noiseFloorRef.current = noiseFloorRef.current * 0.94 + rms * 0.06;
    }

    if (enabledForCurrentLine) {
      if (lineStartedAtRef.current === 0) {
        lineStartedAtRef.current = now;
      }

      if (now - lineStartedAtRef.current < LINE_GRACE_MS) {
        silenceHandledRef.current = false;
      } else if (isAboveThreshold) {
        if (speechStartRef.current === 0) {
          speechStartRef.current = now;
        }

        lastVoiceTimestampRef.current = now;
        silenceHandledRef.current = false;

        if (now - speechStartRef.current >= MIN_SPEECH_MS) {
          hasDetectedVoiceRef.current = true;
        }
      } else {
        if (!hasDetectedVoiceRef.current) {
          if (
            speechStartRef.current > 0 &&
            now - lastVoiceTimestampRef.current > SPEECH_GAP_TOLERANCE_MS
          ) {
            speechStartRef.current = 0;
          }
        }

        if (
          hasDetectedVoiceRef.current &&
          !silenceHandledRef.current &&
          rms <= releaseThreshold &&
          now - lastVoiceTimestampRef.current >= SILENCE_MS
        ) {
          silenceHandledRef.current = true;
          onSilenceDetectedRef.current();
        }
      }
    }

    if (now - lastUiUpdateRef.current >= 120) {
      lastUiUpdateRef.current = now;
      setSignalLevel(Math.min(1, rms / Math.max(adaptiveThreshold * 2.2, MIN_VOICE_THRESHOLD * 2)));
      setRawLevel(rms);
      setHasSpeechStarted(hasDetectedVoiceRef.current);
      setIsSignalAboveThreshold(isAboveThreshold);
      setSilenceElapsedMs(
        hasDetectedVoiceRef.current && lastVoiceTimestampRef.current > 0
          ? Math.max(0, Math.round(now - lastVoiceTimestampRef.current))
          : 0
      );
      setVoiceThreshold(adaptiveThreshold);
      setLineStateLabel(
        now - lineStartedAtRef.current < LINE_GRACE_MS
          ? 'preparando linea'
          : isAboveThreshold
            ? hasDetectedVoiceRef.current
              ? 'hablando'
              : 'armando voz'
            : speechStartRef.current > 0 && !hasDetectedVoiceRef.current
              ? 'armando voz'
            : hasDetectedVoiceRef.current
              ? 'silencio detectado'
              : 'esperando voz'
      );
    }

    frameRef.current = requestAnimationFrame(monitorSignal);
  }, [enabledForCurrentLine]);

  const startListening = useCallback(async () => {
    if (!isListeningSupported) {
      setListeningStatus('unsupported');
      setListeningError('La escucha automatica no esta disponible en este navegador.');
      return;
    }

    if (listeningStatus === 'active' || listeningStatus === 'requesting') {
      return;
    }

    setListeningStatus('requesting');
    setListeningError(null);

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const AudioContextConstructor = getAudioContextConstructor();
      if (!AudioContextConstructor) {
        throw new Error('audio-context-unavailable');
      }

      const audioContext = new AudioContextConstructor();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const sourceNode = audioContext.createMediaStreamSource(mediaStream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      sourceNode.connect(analyser);

      streamRef.current = mediaStream;
      audioContextRef.current = audioContext;
      sourceNodeRef.current = sourceNode;
      analyserRef.current = analyser;
      samplesRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));
      resetLineTracking(
        hasDetectedVoiceRef,
        lastVoiceTimestampRef,
        silenceHandledRef,
        speechStartRef,
        lineStartedAtRef
      );
      setSignalLevel(0);
      setRawLevel(0);
      setHasSpeechStarted(false);
      setIsSignalAboveThreshold(false);
      setSilenceElapsedMs(0);
      setVoiceThreshold(MIN_VOICE_THRESHOLD);
      setLineStateLabel('preparando linea');
      setListeningStatus('active');
      monitorSignal();
    } catch (error) {
      stopListening();

      const errorName =
        error && typeof error === 'object' && 'name' in error ? String(error.name) : '';

      if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
        setListeningError('Necesitamos permiso de microfono para activar la escucha automatica.');
      } else {
        setListeningError('No se pudo activar la escucha automatica.');
      }

      setListeningStatus('error');
    }
  }, [isListeningSupported, listeningStatus, monitorSignal, stopListening]);

  return {
    listeningStatus,
    listeningError,
    isListeningActive: listeningStatus === 'active',
    isListeningSupported,
    signalLevel,
    rawLevel,
    hasSpeechStarted,
    isSignalAboveThreshold,
    silenceElapsedMs,
    voiceThreshold,
    lineStateLabel,
    startListening,
    stopListening,
  };
};
