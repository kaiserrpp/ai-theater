import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ListeningStatus = 'unsupported' | 'idle' | 'requesting' | 'active' | 'error';
type MicrophoneCalibrationStatus =
  | 'idle'
  | 'measuring-silence'
  | 'measuring-voice'
  | 'ready'
  | 'weak'
  | 'error';

export type MicrophoneCalibrationResult = {
  status: MicrophoneCalibrationStatus;
  noiseFloor: number;
  voiceLevel: number;
  voiceThreshold: number;
  voiceToNoiseRatio: number;
};

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
  microphoneCalibrationStatus: MicrophoneCalibrationStatus;
  microphoneCalibrationProgress: number;
  microphoneNoiseFloor: number;
  microphoneVoiceLevel: number;
  lineStateLabel: string;
  calibrateAmbientNoise: (durationMs?: number) => Promise<MicrophoneCalibrationResult>;
  calibrateVoiceLevel: (durationMs?: number) => Promise<MicrophoneCalibrationResult>;
  resetMicrophoneCalibration: () => void;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  releaseListening: () => Promise<void>;
}

const MIN_VOICE_THRESHOLD = 0.012;
const THRESHOLD_MULTIPLIER = 3;
const THRESHOLD_RELEASE_FACTOR = 0.74;
const VOICE_THRESHOLD_FACTOR = 0.55;
const MIN_HEALTHY_VOICE_TO_NOISE_RATIO = 1.8;
const SILENCE_MS = 1000;
const LINE_PREP_MS = 280;
const VOICE_CONFIRM_MS = 140;

type CalibrationRun = {
  mode: 'silence' | 'voice';
  startedAt: number;
  durationMs: number;
  samples: number[];
  timeout: ReturnType<typeof setTimeout>;
  resolve: (result: MicrophoneCalibrationResult) => void;
};

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

const getNow = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const getPercentile = (values: number[], percentile: number) => {
  if (values.length === 0) {
    return 0;
  }

  const sortedValues = [...values].sort((leftValue, rightValue) => leftValue - rightValue);
  const safePercentile = Math.max(0, Math.min(1, percentile));
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.round((sortedValues.length - 1) * safePercentile))
  );

  return sortedValues[index];
};

const buildCalibrationResult = ({
  status,
  noiseFloor,
  voiceLevel,
  voiceThreshold,
}: {
  status: MicrophoneCalibrationStatus;
  noiseFloor: number;
  voiceLevel: number;
  voiceThreshold: number;
}): MicrophoneCalibrationResult => ({
  status,
  noiseFloor,
  voiceLevel,
  voiceThreshold,
  voiceToNoiseRatio: noiseFloor > 0 ? voiceLevel / noiseFloor : Number.POSITIVE_INFINITY,
});

const calculateSessionThreshold = (noiseFloor: number, voiceLevel: number) => {
  const noiseBasedThreshold = Math.max(MIN_VOICE_THRESHOLD, noiseFloor * THRESHOLD_MULTIPLIER);

  if (voiceLevel <= 0) {
    return noiseBasedThreshold;
  }

  return Math.max(
    MIN_VOICE_THRESHOLD,
    Math.min(noiseBasedThreshold, voiceLevel * VOICE_THRESHOLD_FACTOR)
  );
};

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
  const microphoneNoiseFloorRef = useRef(0);
  const microphoneVoiceLevelRef = useRef(0);
  const calibrationRunRef = useRef<CalibrationRun | null>(null);
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
  const [microphoneCalibrationStatus, setMicrophoneCalibrationStatus] =
    useState<MicrophoneCalibrationStatus>('idle');
  const [microphoneCalibrationProgress, setMicrophoneCalibrationProgress] = useState(0);
  const [microphoneNoiseFloor, setMicrophoneNoiseFloor] = useState(0);
  const [microphoneVoiceLevel, setMicrophoneVoiceLevel] = useState(0);
  const [lineStateLabel, setLineStateLabel] = useState('detector en espera');

  onSilenceDetectedRef.current = onSilenceDetected;
  currentLineKeyRef.current = lineKey;
  currentEnabledRef.current = enabledForCurrentLine;

  const resetTrackingState = useCallback((nextLineLabel = 'detector en espera') => {
    lineStartedAtRef.current = 0;
    baselineSumRef.current = 0;
    baselineFramesRef.current = 0;
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
    setVoiceThreshold(currentThresholdRef.current);
    setLineStateLabel(nextLineLabel);
  }, []);

  const resetMicrophoneCalibration = useCallback(() => {
    if (calibrationRunRef.current) {
      clearTimeout(calibrationRunRef.current.timeout);
      calibrationRunRef.current = null;
    }

    microphoneNoiseFloorRef.current = 0;
    microphoneVoiceLevelRef.current = 0;
    currentThresholdRef.current = MIN_VOICE_THRESHOLD;
    releaseThresholdRef.current = MIN_VOICE_THRESHOLD * THRESHOLD_RELEASE_FACTOR;
    setMicrophoneCalibrationStatus('idle');
    setMicrophoneCalibrationProgress(0);
    setMicrophoneNoiseFloor(0);
    setMicrophoneVoiceLevel(0);
    setVoiceThreshold(MIN_VOICE_THRESHOLD);
  }, []);

  const getReusableStream = useCallback(() => {
    const currentStream = streamRef.current;
    if (!currentStream) {
      return null;
    }

    const liveTracks = currentStream
      .getAudioTracks()
      .filter((track) => track.readyState !== 'ended');

    if (liveTracks.length === 0) {
      currentStream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      return null;
    }

    return currentStream;
  }, []);

  const teardownAudioGraph = useCallback(async () => {
    if (frameRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    if (calibrationRunRef.current) {
      clearTimeout(calibrationRunRef.current.timeout);
      const fallbackResult = buildCalibrationResult({
        status: 'error',
        noiseFloor: microphoneNoiseFloorRef.current,
        voiceLevel: microphoneVoiceLevelRef.current,
        voiceThreshold: currentThresholdRef.current,
      });
      calibrationRunRef.current.resolve(fallbackResult);
      calibrationRunRef.current = null;
      setMicrophoneCalibrationStatus('error');
      setMicrophoneCalibrationProgress(0);
    }

    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }

    if (audioContextRef.current) {
      const context = audioContextRef.current;
      audioContextRef.current = null;
      await context.close().catch(() => undefined);
    }

    samplesRef.current = null;
  }, []);

  const prepareLineTracking = useCallback((lineToken: string, timestamp: number) => {
    processedLineKeyRef.current = lineToken;
    lineStartedAtRef.current = timestamp;
    baselineSumRef.current = 0;
    baselineFramesRef.current = 0;
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
    setVoiceThreshold(currentThresholdRef.current);
    setLineStateLabel('preparando linea');
  }, []);

  const stopListening = useCallback(async () => {
    requestVersionRef.current += 1;
    await teardownAudioGraph();
    getReusableStream()?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    processedLineKeyRef.current = null;
    resetTrackingState();
    setListeningStatus(isListeningSupported ? 'idle' : 'unsupported');
    setListeningError(null);
  }, [getReusableStream, isListeningSupported, resetTrackingState, teardownAudioGraph]);

  const releaseListening = useCallback(async () => {
    requestVersionRef.current += 1;
    await teardownAudioGraph();

    const currentStream = streamRef.current;
    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    processedLineKeyRef.current = null;
    resetTrackingState();
    resetMicrophoneCalibration();
    setListeningStatus(isListeningSupported ? 'idle' : 'unsupported');
    setListeningError(null);
  }, [isListeningSupported, resetMicrophoneCalibration, resetTrackingState, teardownAudioGraph]);

  useEffect(() => () => {
    void releaseListening();
  }, [releaseListening]);

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
    const now = getNow();
    const frameDeltaMs = lastFrameTimestampRef.current > 0 ? now - lastFrameTimestampRef.current : 16;
    lastFrameTimestampRef.current = now;

    const calibrationRun = calibrationRunRef.current;
    if (calibrationRun) {
      calibrationRun.samples.push(rms);
      const elapsedMs = now - calibrationRun.startedAt;
      const progress = Math.max(0, Math.min(1, elapsedMs / calibrationRun.durationMs));
      setMicrophoneCalibrationProgress(progress);

      if (elapsedMs >= calibrationRun.durationMs) {
        clearTimeout(calibrationRun.timeout);
        calibrationRunRef.current = null;

        if (calibrationRun.mode === 'silence') {
          const noiseFloor = Math.max(getPercentile(calibrationRun.samples, 0.82), 0);
          microphoneNoiseFloorRef.current = noiseFloor;
          const nextThreshold = calculateSessionThreshold(noiseFloor, microphoneVoiceLevelRef.current);
          currentThresholdRef.current = nextThreshold;
          releaseThresholdRef.current = nextThreshold * THRESHOLD_RELEASE_FACTOR;
          setMicrophoneNoiseFloor(noiseFloor);
          setVoiceThreshold(nextThreshold);
          setMicrophoneCalibrationStatus('ready');
          setMicrophoneCalibrationProgress(1);
          calibrationRun.resolve(
            buildCalibrationResult({
              status: 'ready',
              noiseFloor,
              voiceLevel: microphoneVoiceLevelRef.current,
              voiceThreshold: nextThreshold,
            })
          );
        } else {
          const voiceLevel = Math.max(getPercentile(calibrationRun.samples, 0.86), 0);
          const noiseFloor = microphoneNoiseFloorRef.current;
          const nextThreshold = calculateSessionThreshold(noiseFloor, voiceLevel);
          const voiceToNoiseRatio =
            noiseFloor > 0 ? voiceLevel / noiseFloor : Number.POSITIVE_INFINITY;
          const nextStatus: MicrophoneCalibrationStatus =
            voiceToNoiseRatio >= MIN_HEALTHY_VOICE_TO_NOISE_RATIO ? 'ready' : 'weak';

          microphoneVoiceLevelRef.current = voiceLevel;
          currentThresholdRef.current = nextThreshold;
          releaseThresholdRef.current = nextThreshold * THRESHOLD_RELEASE_FACTOR;
          setMicrophoneVoiceLevel(voiceLevel);
          setVoiceThreshold(nextThreshold);
          setMicrophoneCalibrationStatus(nextStatus);
          setMicrophoneCalibrationProgress(1);
          calibrationRun.resolve(
            buildCalibrationResult({
              status: nextStatus,
              noiseFloor,
              voiceLevel,
              voiceThreshold: nextThreshold,
            })
          );
        }
      }
    }

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
        nextLineState = 'preparando linea';
      } else {
        activeThreshold = currentThresholdRef.current;
        activeReleaseThreshold = releaseThresholdRef.current;

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

  const runMicrophoneCalibration = useCallback(
    async (mode: 'silence' | 'voice', durationMs: number) => {
      if (!analyserRef.current || !samplesRef.current) {
        const result = buildCalibrationResult({
          status: 'error',
          noiseFloor: microphoneNoiseFloorRef.current,
          voiceLevel: microphoneVoiceLevelRef.current,
          voiceThreshold: currentThresholdRef.current,
        });
        setMicrophoneCalibrationStatus('error');
        return result;
      }

      if (calibrationRunRef.current) {
        clearTimeout(calibrationRunRef.current.timeout);
        calibrationRunRef.current = null;
      }

      setMicrophoneCalibrationStatus(mode === 'silence' ? 'measuring-silence' : 'measuring-voice');
      setMicrophoneCalibrationProgress(0);

      return new Promise<MicrophoneCalibrationResult>((resolve) => {
        const startedAt = getNow();
        const timeout = setTimeout(() => {
          if (!calibrationRunRef.current) {
            return;
          }

          const currentRun = calibrationRunRef.current;
          calibrationRunRef.current = null;
          const samples = currentRun.samples;

          if (currentRun.mode === 'silence') {
            const noiseFloor = Math.max(getPercentile(samples, 0.82), 0);
            const nextThreshold = calculateSessionThreshold(
              noiseFloor,
              microphoneVoiceLevelRef.current
            );
            microphoneNoiseFloorRef.current = noiseFloor;
            currentThresholdRef.current = nextThreshold;
            releaseThresholdRef.current = nextThreshold * THRESHOLD_RELEASE_FACTOR;
            setMicrophoneNoiseFloor(noiseFloor);
            setVoiceThreshold(nextThreshold);
            setMicrophoneCalibrationStatus('ready');
            setMicrophoneCalibrationProgress(1);
            resolve(
              buildCalibrationResult({
                status: 'ready',
                noiseFloor,
                voiceLevel: microphoneVoiceLevelRef.current,
                voiceThreshold: nextThreshold,
              })
            );
            return;
          }

          const voiceLevel = Math.max(getPercentile(samples, 0.86), 0);
          const noiseFloor = microphoneNoiseFloorRef.current;
          const nextThreshold = calculateSessionThreshold(noiseFloor, voiceLevel);
          const voiceToNoiseRatio =
            noiseFloor > 0 ? voiceLevel / noiseFloor : Number.POSITIVE_INFINITY;
          const nextStatus: MicrophoneCalibrationStatus =
            voiceToNoiseRatio >= MIN_HEALTHY_VOICE_TO_NOISE_RATIO ? 'ready' : 'weak';

          microphoneVoiceLevelRef.current = voiceLevel;
          currentThresholdRef.current = nextThreshold;
          releaseThresholdRef.current = nextThreshold * THRESHOLD_RELEASE_FACTOR;
          setMicrophoneVoiceLevel(voiceLevel);
          setVoiceThreshold(nextThreshold);
          setMicrophoneCalibrationStatus(nextStatus);
          setMicrophoneCalibrationProgress(1);
          resolve(
            buildCalibrationResult({
              status: nextStatus,
              noiseFloor,
              voiceLevel,
              voiceThreshold: nextThreshold,
            })
          );
        }, durationMs + 180);

        calibrationRunRef.current = {
          mode,
          startedAt,
          durationMs,
          samples: [],
          timeout,
          resolve,
        };
      });
    },
    []
  );

  const calibrateAmbientNoise = useCallback(
    (durationMs = 1800) => runMicrophoneCalibration('silence', durationMs),
    [runMicrophoneCalibration]
  );

  const calibrateVoiceLevel = useCallback(
    (durationMs = 2200) => runMicrophoneCalibration('voice', durationMs),
    [runMicrophoneCalibration]
  );

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
      const reusableStream = getReusableStream();
      const mediaStream =
        reusableStream ??
        (await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        }));

      mediaStream.getAudioTracks().forEach((track) => {
        track.enabled = true;
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
        if (!reusableStream) {
          mediaStream.getTracks().forEach((track) => track.stop());
        }
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
      releaseListening();

      const errorName =
        error && typeof error === 'object' && 'name' in error ? String(error.name) : '';

      if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
        setListeningError('Necesitamos permiso de microfono para activar la escucha automatica.');
      } else {
        setListeningError('No se pudo activar la escucha automatica.');
      }

      setListeningStatus('error');
    }
  }, [
    getReusableStream,
    isListeningSupported,
    listeningStatus,
    monitorSignal,
    releaseListening,
    resetTrackingState,
  ]);

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
    microphoneCalibrationStatus,
    microphoneCalibrationProgress,
    microphoneNoiseFloor,
    microphoneVoiceLevel,
    lineStateLabel,
    calibrateAmbientNoise,
    calibrateVoiceLevel,
    resetMicrophoneCalibration,
    startListening,
    stopListening,
    releaseListening,
  };
};
