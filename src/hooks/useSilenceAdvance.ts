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
  isVoiceDetected: boolean;
  silenceElapsedMs: number;
  startListening: () => Promise<void>;
  stopListening: () => void;
}

const VOICE_THRESHOLD = 0.025;
const SILENCE_MS = 1000;

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
  silenceHandledRef: React.MutableRefObject<boolean>
) => {
  hasDetectedVoiceRef.current = false;
  lastVoiceTimestampRef.current = 0;
  silenceHandledRef.current = false;
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
  const lastUiUpdateRef = useRef(0);

  const isListeningSupported = useMemo(isListeningSupportedOnDevice, []);
  const [listeningStatus, setListeningStatus] = useState<ListeningStatus>(
    isListeningSupported ? 'idle' : 'unsupported'
  );
  const [listeningError, setListeningError] = useState<string | null>(null);
  const [signalLevel, setSignalLevel] = useState(0);
  const [isVoiceDetected, setIsVoiceDetected] = useState(false);
  const [silenceElapsedMs, setSilenceElapsedMs] = useState(0);

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
    resetLineTracking(hasDetectedVoiceRef, lastVoiceTimestampRef, silenceHandledRef);
    lastUiUpdateRef.current = 0;
    setListeningStatus(isListeningSupported ? 'idle' : 'unsupported');
    setListeningError(null);
    setSignalLevel(0);
    setIsVoiceDetected(false);
    setSilenceElapsedMs(0);
  }, [isListeningSupported]);

  useEffect(() => () => {
    stopListening();
  }, [stopListening]);

  useEffect(() => {
    resetLineTracking(hasDetectedVoiceRef, lastVoiceTimestampRef, silenceHandledRef);
    setSignalLevel(0);
    setIsVoiceDetected(false);
    setSilenceElapsedMs(0);
  }, [lineKey]);

  useEffect(() => {
    if (!enabledForCurrentLine) {
      resetLineTracking(hasDetectedVoiceRef, lastVoiceTimestampRef, silenceHandledRef);
      setSignalLevel(0);
      setIsVoiceDetected(false);
      setSilenceElapsedMs(0);
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
    const now =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();

    if (enabledForCurrentLine) {
      if (rms >= VOICE_THRESHOLD) {
        hasDetectedVoiceRef.current = true;
        lastVoiceTimestampRef.current = now;
        silenceHandledRef.current = false;
      } else if (
        hasDetectedVoiceRef.current &&
        !silenceHandledRef.current &&
        now - lastVoiceTimestampRef.current >= SILENCE_MS
      ) {
        silenceHandledRef.current = true;
        onSilenceDetectedRef.current();
      }
    }

    if (now - lastUiUpdateRef.current >= 120) {
      lastUiUpdateRef.current = now;
      setSignalLevel(Math.min(1, rms / (VOICE_THRESHOLD * 4)));
      setIsVoiceDetected(hasDetectedVoiceRef.current);
      setSilenceElapsedMs(
        hasDetectedVoiceRef.current && lastVoiceTimestampRef.current > 0
          ? Math.max(0, Math.round(now - lastVoiceTimestampRef.current))
          : 0
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
      resetLineTracking(hasDetectedVoiceRef, lastVoiceTimestampRef, silenceHandledRef);
      setSignalLevel(0);
      setIsVoiceDetected(false);
      setSilenceElapsedMs(0);
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
    isVoiceDetected,
    silenceElapsedMs,
    startListening,
    stopListening,
  };
};
