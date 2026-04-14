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

const MIN_VOICE_THRESHOLD = 0.012;
const THRESHOLD_MULTIPLIER = 3;
const THRESHOLD_RELEASE_FACTOR = 0.74;
const SILENCE_MS = 1000;
const LINE_PREP_MS = 280;
const VOICE_CONFIRM_MS = 140;

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

export const useSilenceAdvance = ({
  enabledForCurrentLine,
  lineKey,
  onSilenceDetected,
}: UseSilenceAdvanceOptions): UseSilenceAdvanceResult => {
  const onSilenceDetectedRef = useRef(onSilenceDetected);
  const currentLineKeyRef = useRef<string | null>(lineKey);
  const currentEnabledRef = useRef(enabledForCurrentLine);
  const processedLineKeyRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const frameRef = useRef<number | null>(null);
  const samplesRef = useRef<Uint8Array | null>(null);
  const lineStartedAtRef = useRef(0);
  const baselineSumRef = useRef(0);
  const baselineFramesRef = useRef(0);
  const currentThresholdRef = useRef(MIN_VOICE_THRESHOLD);
  const releaseThresholdRef = useRef(MIN_VOICE_THRESHOLD * THRESHOLD_RELEASE_FACTOR);
  const voiceBurstMsRef = useRef(0);
  const lastVoiceTimestampRef = useRef(0);
  const silenceStartedAtRef = useRef(0);
  const hasDetectedVoiceRef = useRef(false);
  const lineCompletedRef = useRef(false);
  const lastUiUpdateRef = useRef(0);
  const lastFrameTimestampRef = useRef(0);
  const requestVersionRef = useRef(0);

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
  const [lineStateLabel, setLineStateLabel] = useState('detector en espera');

  onSilenceDetectedRef.current = onSilenceDetected;
  currentLineKeyRef.current = lineKey;
  currentEnabledRef.current = enabledForCurrentLine;

  const resetTrackingState = useCallback((nextLineLabel = 'detector en espera') => {
    lineStartedAtRef.current = 0;
    baselineSumRef.current = 0;
    baselineFramesRef.current = 0;
    currentThresholdRef.current = MIN_VOICE_THRESHOLD;
    releaseThresholdRef.current = MIN_VOICE_THRESHOLD * THRESHOLD_RELEASE_FACTOR;
    voiceBurstMsRef.current = 0;
    lastVoiceTimestampRef.current = 0;
    silenceStartedAtRef.current = 0;
    hasDetectedVoiceRef.current = false;
    lineCompletedRef.current = false;
    lastFrameTimestampRef.current = 0;
    lastUiUpdateRef.current = 0;
    setSignalLevel(0);
    setRawLevel(0);
    setHasSpeechStarted(false);
    setIsSignalAboveThreshold(false);
    setSilenceElapsedMs(0);
    setVoiceThreshold(MIN_VOICE_THRESHOLD);
    setLineStateLabel(nextLineLabel);
  }, []);

  const prepareLineTracking = useCallback((lineToken: string, timestamp: number) => {
    processedLineKeyRef.current = lineToken;
    lineStartedAtRef.current = timestamp;
    baselineSumRef.current = 0;
    baselineFramesRef.current = 0;
    currentThresholdRef.current = MIN_VOICE_THRESHOLD;
    releaseThresholdRef.current = MIN_VOICE_THRESHOLD * THRESHOLD_RELEASE_FACTOR;
    voiceBurstMsRef.current = 0;
    lastVoiceTimestampRef.current = 0;
    silenceStartedAtRef.current = 0;
    hasDetectedVoiceRef.current = false;
    lineCompletedRef.current = false;
    lastFrameTimestampRef.current = timestamp;
    lastUiUpdateRef.current = 0;
    setSignalLevel(0);
    setRawLevel(0);
    setHasSpeechStarted(false);
    setIsSignalAboveThreshold(false);
    setSilenceElapsedMs(0);
    setVoiceThreshold(MIN_VOICE_THRESHOLD);
    setLineStateLabel('preparando linea');
  }, []);

  const stopListening = useCallback(() => {
    requestVersionRef.current += 1;

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
    processedLineKeyRef.current = null;
    resetTrackingState();
    setListeningStatus(isListeningSupported ? 'idle' : 'unsupported');
    setListeningError(null);
  }, [isListeningSupported, resetTrackingState]);

  useEffect(() => () => {
    stopListening();
  }, [stopListening]);

  useEffect(() => {
    if (!enabledForCurrentLine) {
      processedLineKeyRef.current = lineKey;
      resetTrackingState('detector en espera');
    }
  }, [enabledForCurrentLine, lineKey, resetTrackingState]);

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
    const frameDeltaMs = lastFrameTimestampRef.current > 0 ? now - lastFrameTimestampRef.current : 16;
    lastFrameTimestampRef.current = now;

    const enabled = currentEnabledRef.current && Boolean(currentLineKeyRef.current);
    let activeThreshold = currentThresholdRef.current;
    let activeReleaseThreshold = releaseThresholdRef.current;
    let isAboveThreshold = false;
    let nextSilenceElapsedMs = 0;
    let nextLineState = enabled ? 'preparando linea' : 'detector en espera';

    if (!enabled) {
      processedLineKeyRef.current = currentLineKeyRef.current;
      voiceBurstMsRef.current = 0;
      silenceStartedAtRef.current = 0;
      hasDetectedVoiceRef.current = false;
      lineCompletedRef.current = false;
    } else {
      const activeLineKey = currentLineKeyRef.current as string;

      if (processedLineKeyRef.current !== activeLineKey) {
        prepareLineTracking(activeLineKey, now);
      }

      const lineAgeMs = now - lineStartedAtRef.current;

      if (lineAgeMs < LINE_PREP_MS) {
        baselineSumRef.current += rms;
        baselineFramesRef.current += 1;
        nextLineState = 'preparando linea';
      } else {
        if (baselineFramesRef.current > 0 && currentThresholdRef.current === MIN_VOICE_THRESHOLD) {
          const baselineAverage = baselineSumRef.current / baselineFramesRef.current;
          activeThreshold = Math.max(MIN_VOICE_THRESHOLD, baselineAverage * THRESHOLD_MULTIPLIER);
          activeReleaseThreshold = activeThreshold * THRESHOLD_RELEASE_FACTOR;
          currentThresholdRef.current = activeThreshold;
          releaseThresholdRef.current = activeReleaseThreshold;
          baselineFramesRef.current = 0;
          baselineSumRef.current = 0;
        } else {
          activeThreshold = currentThresholdRef.current;
          activeReleaseThreshold = releaseThresholdRef.current;
        }

        isAboveThreshold = rms >= activeThreshold;

        if (lineCompletedRef.current) {
          nextLineState = 'linea completada';
          nextSilenceElapsedMs = SILENCE_MS;
        } else if (!hasDetectedVoiceRef.current) {
          if (isAboveThreshold) {
            voiceBurstMsRef.current += frameDeltaMs;
            nextLineState = 'armando voz';

            if (voiceBurstMsRef.current >= VOICE_CONFIRM_MS) {
              hasDetectedVoiceRef.current = true;
              lastVoiceTimestampRef.current = now;
              silenceStartedAtRef.current = 0;
              nextLineState = 'hablando';
            }
          } else {
            voiceBurstMsRef.current = 0;
            nextLineState = 'esperando voz';
          }
        } else if (isAboveThreshold || rms >= activeReleaseThreshold) {
          lastVoiceTimestampRef.current = now;
          silenceStartedAtRef.current = 0;
          nextLineState = 'hablando';
        } else {
          if (silenceStartedAtRef.current === 0) {
            silenceStartedAtRef.current = now;
          }

          nextSilenceElapsedMs = Math.max(0, Math.round(now - silenceStartedAtRef.current));
          nextLineState = 'silencio detectado';

          if (nextSilenceElapsedMs >= SILENCE_MS) {
            lineCompletedRef.current = true;
            nextLineState = 'linea completada';
            onSilenceDetectedRef.current();
          }
        }
      }
    }

    if (now - lastUiUpdateRef.current >= 120) {
      lastUiUpdateRef.current = now;
      setSignalLevel(
        Math.min(1, rms / Math.max(activeThreshold * 2.4, MIN_VOICE_THRESHOLD * 2.4))
      );
      setRawLevel(rms);
      setHasSpeechStarted(hasDetectedVoiceRef.current);
      setIsSignalAboveThreshold(isAboveThreshold);
      setSilenceElapsedMs(nextSilenceElapsedMs);
      setVoiceThreshold(activeThreshold);
      setLineStateLabel(nextLineState);
    }

    frameRef.current = requestAnimationFrame(monitorSignal);
  }, [prepareLineTracking]);

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
      const requestVersion = requestVersionRef.current + 1;
      requestVersionRef.current = requestVersion;
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

      if (requestVersionRef.current !== requestVersion) {
        sourceNode.disconnect();
        analyser.disconnect();
        mediaStream.getTracks().forEach((track) => track.stop());
        void audioContext.close().catch(() => undefined);
        return;
      }

      streamRef.current = mediaStream;
      audioContextRef.current = audioContext;
      sourceNodeRef.current = sourceNode;
      analyserRef.current = analyser;
      samplesRef.current = new Uint8Array(analyser.fftSize);
      processedLineKeyRef.current = null;
      resetTrackingState();
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
  }, [isListeningSupported, listeningStatus, monitorSignal, resetTrackingState, stopListening]);

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
