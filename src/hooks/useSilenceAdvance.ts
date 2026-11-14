import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { asMicrophoneInputError, getMicrophoneInputContext, getMicrophoneInputErrorMessage } from '../utils/microphoneInputHelp';
import { captureMicrophoneInput, type MicrophoneCaptureProfile, type MicrophoneInputDiagnostic } from '../utils/microphoneCapture';
import { getNativeLevelInput, waitForNativeLevelInput, type NativeLevelCapture } from '../utils/nativePrototype';

type ListeningStatus = 'unsupported' | 'idle' | 'requesting' | 'active' | 'error';
type MicrophoneCalibrationStatus =
  | 'idle'
  | 'measuring-silence'
  | 'measuring-voice'
  | 'ready'
  | 'weak'
  | 'error';

export type MicrophoneCalibrationResult = {
  measurement?: 'rms' | 'native_peak';
  status: MicrophoneCalibrationStatus;
  noiseFloor: number;
  voiceLevel: number;
  voiceThreshold: number;
  voiceToNoiseRatio: number;
};

export type MicrophoneCalibrationSnapshot = {
  measurement?: 'rms' | 'native_peak';
  status?: MicrophoneCalibrationStatus;
  noiseFloor: number;
  voiceLevel: number;
  voiceThreshold: number;
};

interface UseSilenceAdvanceOptions {
  preferNativeInput?: boolean;
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
  microphoneCalibrationMeasurement: 'rms' | 'native_peak';
  lineStateLabel: string;
  calibrateAmbientNoise: (durationMs?: number) => Promise<MicrophoneCalibrationResult>;
  calibrateVoiceLevel: (durationMs?: number) => Promise<MicrophoneCalibrationResult>;
  applyMicrophoneCalibration: (snapshot: MicrophoneCalibrationSnapshot) => void;
  resetMicrophoneCalibration: () => void;
  startListening: () => Promise<void>;
  getMicrophoneInputFailure: () => Error | null;
  getMicrophoneInputDiagnostic: () => MicrophoneInputDiagnostic | null;
  stopListening: () => Promise<void>;
  releaseListeningInput: () => Promise<void>;
  releaseListening: () => Promise<void>;
}

const MIN_VOICE_THRESHOLD = 0.012;
const THRESHOLD_MULTIPLIER = 3;
const THRESHOLD_RELEASE_FACTOR = 0.74;
const VOICE_THRESHOLD_FACTOR = 0.55;
const MIN_HEALTHY_VOICE_TO_NOISE_RATIO = 1.8;
const VOICE_CALIBRATION_MAX_WAIT_MS = 10000;
const VOICE_CALIBRATION_MIN_SIGNAL_FACTOR = 1.04;
const VOICE_CALIBRATION_MIN_DELTA = 0.0006;
const SILENCE_MS = 650;
const LINE_PREP_MS = 140;
const VOICE_CONFIRM_MS = 90;

type CalibrationRun = {
  mode: 'silence' | 'voice';
  startedAt: number;
  sampleStartedAt: number;
  durationMs: number;
  maxWaitMs: number;
  samples: number[];
  voiceBurstMs: number;
  nativeSamples: number;
  firstNativeAt: number;
  lastNativeAt: number;
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

const hasUsableVoiceCalibration = (noiseFloor: number, voiceLevel: number) =>
  voiceLevel >=
  Math.max(
    MIN_VOICE_THRESHOLD * 0.12,
    noiseFloor + VOICE_CALIBRATION_MIN_DELTA,
    noiseFloor * VOICE_CALIBRATION_MIN_SIGNAL_FACTOR
  );

export const useSilenceAdvance = ({
  preferNativeInput = false,
  enabledForCurrentLine,
  lineKey,
  onSilenceDetected,
}: UseSilenceAdvanceOptions): UseSilenceAdvanceResult => {
  const onSilenceDetectedRef = useRef(onSilenceDetected);
  const currentLineKeyRef = useRef<string | null>(lineKey);
  const currentEnabledRef = useRef(enabledForCurrentLine);
  const processedLineKeyRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeCaptureRef = useRef<NativeLevelCapture | null>(null);
  const nativeSampleRef = useRef<{ level: number; at: number } | null>(null);
  const measurementRef = useRef<'rms' | 'native_peak'>('rms');
  const [microphoneCalibrationMeasurement, setMicrophoneCalibrationMeasurement] = useState<'rms' | 'native_peak'>('rms');
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
  const microphoneInputFailureRef = useRef<Error | null>(null);
  const getMicrophoneInputFailure = useCallback(() => microphoneInputFailureRef.current, []);
  const microphoneInputDiagnosticRef = useRef<MicrophoneInputDiagnostic | null>(null);
  const captureProfileRef = useRef<MicrophoneCaptureProfile>('processed');
  const getMicrophoneInputDiagnostic = useCallback(() => microphoneInputDiagnosticRef.current, []);

  const isListeningSupported = useMemo(() => Boolean(preferNativeInput && getNativeLevelInput()) || isListeningSupportedOnDevice(), [preferNativeInput]);
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

  const applyMicrophoneCalibration = useCallback((snapshot: MicrophoneCalibrationSnapshot) => {
    measurementRef.current = snapshot.measurement || 'rms';
    setMicrophoneCalibrationMeasurement(measurementRef.current);
    const safeNoiseFloor = Math.max(0, snapshot.noiseFloor);
    const safeVoiceLevel = Math.max(0, snapshot.voiceLevel);
    const safeThreshold = Math.max(MIN_VOICE_THRESHOLD, snapshot.voiceThreshold);
    const safeStatus =
      snapshot.status === 'weak' || snapshot.status === 'ready' ? snapshot.status : 'ready';

    microphoneNoiseFloorRef.current = safeNoiseFloor;
    microphoneVoiceLevelRef.current = safeVoiceLevel;
    currentThresholdRef.current = safeThreshold;
    releaseThresholdRef.current = safeThreshold * THRESHOLD_RELEASE_FACTOR;
    setMicrophoneNoiseFloor(safeNoiseFloor);
    setMicrophoneVoiceLevel(safeVoiceLevel);
    setVoiceThreshold(safeThreshold);
    setMicrophoneCalibrationStatus(safeStatus);
    setMicrophoneCalibrationProgress(1);
  }, []);

  const getReusableStream = useCallback(() => {
    const currentStream = streamRef.current;
    if (!currentStream) {
      return null;
    }

    const liveTracks = currentStream
      .getAudioTracks()
      .filter((track) => track.readyState !== 'ended' && !track.muted);

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

    samplesRef.current = null;

    if (audioContextRef.current) {
      const context = audioContextRef.current;
      audioContextRef.current = null;
      await context.close().catch(() => undefined);
    }
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
    const version = ++requestVersionRef.current;
    const nativeCapture = nativeCaptureRef.current; nativeCaptureRef.current = null; nativeSampleRef.current = null;
    const stream = getReusableStream();
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = false;
    });
    await teardownAudioGraph();
    if (nativeCapture) await waitForNativeLevelInput(nativeCapture.stop());
    if (requestVersionRef.current !== version) return;
    processedLineKeyRef.current = null;
    resetTrackingState();
    setListeningStatus(isListeningSupported ? 'idle' : 'unsupported');
    setListeningError(null);
  }, [getReusableStream, isListeningSupported, resetTrackingState, teardownAudioGraph]);

  const releaseListeningInput = useCallback(async () => {
    const version = ++requestVersionRef.current;
    const currentStream = streamRef.current;
    streamRef.current = null;
    const nativeCapture = nativeCaptureRef.current; nativeCaptureRef.current = null; nativeSampleRef.current = null;
    // Release the owned physical input before waiting for AudioContext.close().
    // A mobile audio backend must not have to wait for a still-live capture.
    if (currentStream) {
      currentStream.getTracks().forEach((track) => track.stop());
    }
    await teardownAudioGraph();
    if (nativeCapture) await waitForNativeLevelInput(nativeCapture.stop());

    if (requestVersionRef.current !== version) return;
    processedLineKeyRef.current = null;
    resetTrackingState();
    setListeningStatus(microphoneInputFailureRef.current ? 'error' : isListeningSupported ? 'idle' : 'unsupported');
    setListeningError(microphoneInputFailureRef.current ? getMicrophoneInputErrorMessage(microphoneInputFailureRef.current) : null);
  }, [isListeningSupported, resetTrackingState, teardownAudioGraph]);

  const releaseListening = useCallback(async () => {
    const version = requestVersionRef.current + 1;
    await releaseListeningInput();
    if (requestVersionRef.current === version) resetMicrophoneCalibration();
  }, [releaseListeningInput, resetMicrophoneCalibration]);

  useEffect(() => () => {
    void releaseListening();
  }, [releaseListening]);

  useEffect(() => {
    if (!enabledForCurrentLine) {
      processedLineKeyRef.current = lineKey;
      resetTrackingState('detector en espera');
    }
  }, [enabledForCurrentLine, lineKey, resetTrackingState]);

  const hasNativeMeasurements = useCallback((run: CalibrationRun) => {
    if (measurementRef.current !== 'native_peak' || (run.nativeSamples >= 8 && run.lastNativeAt - run.firstNativeAt >= run.durationMs / 2 && getNow() - run.lastNativeAt < 300)) return true;
    const failure = new Error('El grabador nativo dejó de entregar suficientes niveles recientes.'); failure.name = 'NativeCaptureError';
    microphoneInputFailureRef.current = failure;
    microphoneInputDiagnosticRef.current = { ...microphoneInputDiagnosticRef.current!, status: 'error', stage: 'processor', errorName: failure.name, errorMessage: failure.message };
    return false;
  }, []);

  const monitorSignal = useCallback(() => {
    const analyser = analyserRef.current;
    const samples = samplesRef.current;

    if ((!nativeCaptureRef.current && (!analyser || !samples)) || typeof requestAnimationFrame !== 'function') {
      return;
    }

    const now = getNow();
    const nativeSample = nativeSampleRef.current;
    let sumSquares = 0;
    if (analyser && samples) {
      analyser.getByteTimeDomainData(samples as unknown as Uint8Array<ArrayBuffer>);
      for (let index = 0; index < samples.length; index += 1) {
        const normalizedSample = (samples[index] - 128) / 128;
        sumSquares += normalizedSample * normalizedSample;
      }
    }

    const rms = nativeCaptureRef.current ? nativeSample && now - nativeSample.at < 300 ? nativeSample.level : 0
      : Math.sqrt(sumSquares / samples!.length);
    const frameDeltaMs = lastFrameTimestampRef.current > 0 ? now - lastFrameTimestampRef.current : 16;
    lastFrameTimestampRef.current = now;

    const calibrationRun = calibrationRunRef.current;
    if (calibrationRun) {
      if (calibrationRun.mode === 'voice' && calibrationRun.sampleStartedAt === 0) {
        const voiceStartThreshold = Math.max(
          MIN_VOICE_THRESHOLD * 0.12,
          microphoneNoiseFloorRef.current + VOICE_CALIBRATION_MIN_DELTA,
          microphoneNoiseFloorRef.current * VOICE_CALIBRATION_MIN_SIGNAL_FACTOR
        );

        if (rms >= voiceStartThreshold) {
          calibrationRun.voiceBurstMs += frameDeltaMs;
          if (calibrationRun.voiceBurstMs >= VOICE_CONFIRM_MS) {
            calibrationRun.sampleStartedAt = now;
            calibrationRun.samples = [rms];
            calibrationRun.nativeSamples = 0; calibrationRun.firstNativeAt = 0; calibrationRun.lastNativeAt = 0;
          }
        } else {
          calibrationRun.voiceBurstMs = 0;
        }

        const waitElapsedMs = now - calibrationRun.startedAt;
        setMicrophoneCalibrationProgress(Math.min(0.08, waitElapsedMs / calibrationRun.maxWaitMs));

        if (waitElapsedMs >= calibrationRun.maxWaitMs) {
          hasNativeMeasurements(calibrationRun);
          clearTimeout(calibrationRun.timeout);
          calibrationRunRef.current = null;
          const fallbackResult = buildCalibrationResult({
            status: 'error',
            noiseFloor: microphoneNoiseFloorRef.current,
            voiceLevel: 0,
            voiceThreshold: currentThresholdRef.current,
          });
          setMicrophoneCalibrationStatus('error');
          setMicrophoneCalibrationProgress(0);
          calibrationRun.resolve(fallbackResult);
        }
      } else {
        if (measurementRef.current !== 'native_peak') calibrationRun.samples.push(rms);
        const sampleStartedAt = calibrationRun.sampleStartedAt || calibrationRun.startedAt;
        const elapsedMs = now - sampleStartedAt;
        const progress = Math.max(0, Math.min(1, elapsedMs / calibrationRun.durationMs));
        setMicrophoneCalibrationProgress(progress);

        if (elapsedMs >= calibrationRun.durationMs) {
          clearTimeout(calibrationRun.timeout);
          calibrationRunRef.current = null;

          if (!hasNativeMeasurements(calibrationRun)) {
            setMicrophoneCalibrationStatus('error'); setMicrophoneCalibrationProgress(0);
            calibrationRun.resolve(buildCalibrationResult({ status: 'error', noiseFloor: microphoneNoiseFloorRef.current,
              voiceLevel: 0, voiceThreshold: currentThresholdRef.current }));
          } else if (calibrationRun.mode === 'silence') {
            const noiseFloor = Math.max(getPercentile(calibrationRun.samples, 0.82), 0);
            microphoneNoiseFloorRef.current = noiseFloor;
            const nextThreshold = calculateSessionThreshold(
              noiseFloor,
              microphoneVoiceLevelRef.current
            );
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
              hasUsableVoiceCalibration(noiseFloor, voiceLevel)
                ? voiceToNoiseRatio >= MIN_HEALTHY_VOICE_TO_NOISE_RATIO
                  ? 'ready'
                  : 'weak'
                : 'error';

            microphoneVoiceLevelRef.current = voiceLevel;
            setMicrophoneVoiceLevel(voiceLevel);
            setMicrophoneCalibrationStatus(nextStatus);

            if (nextStatus === 'error') {
              setMicrophoneCalibrationProgress(0);
            } else {
              currentThresholdRef.current = nextThreshold;
              releaseThresholdRef.current = nextThreshold * THRESHOLD_RELEASE_FACTOR;
              setVoiceThreshold(nextThreshold);
              setMicrophoneCalibrationProgress(1);
            }

            calibrationRun.resolve(
              buildCalibrationResult({
                status: nextStatus,
                noiseFloor,
                voiceLevel,
                voiceThreshold: nextStatus === 'error' ? currentThresholdRef.current : nextThreshold,
              })
            );
          }
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
  }, [prepareLineTracking, hasNativeMeasurements]);

  const runMicrophoneCalibration = useCallback(
    async (mode: 'silence' | 'voice', durationMs: number) => {
      if (!nativeCaptureRef.current && (!analyserRef.current || !samplesRef.current)) {
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
        const maxWaitMs = mode === 'voice' ? VOICE_CALIBRATION_MAX_WAIT_MS : durationMs;
        const timeout = setTimeout(() => {
          if (!calibrationRunRef.current) {
            return;
          }

          const currentRun = calibrationRunRef.current;
          calibrationRunRef.current = null;
          const samples = currentRun.samples;

          if (!hasNativeMeasurements(currentRun) || (currentRun.mode === 'voice' && currentRun.sampleStartedAt === 0)) {
            const result = buildCalibrationResult({
              status: 'error',
              noiseFloor: microphoneNoiseFloorRef.current,
              voiceLevel: 0,
              voiceThreshold: currentThresholdRef.current,
            });
            setMicrophoneCalibrationStatus('error');
            setMicrophoneCalibrationProgress(0);
            resolve(result);
            return;
          }

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
            hasUsableVoiceCalibration(noiseFloor, voiceLevel)
              ? voiceToNoiseRatio >= MIN_HEALTHY_VOICE_TO_NOISE_RATIO
                ? 'ready'
                : 'weak'
              : 'error';

          microphoneVoiceLevelRef.current = voiceLevel;
          setMicrophoneVoiceLevel(voiceLevel);
          setMicrophoneCalibrationStatus(nextStatus);

          if (nextStatus === 'error') {
            setMicrophoneCalibrationProgress(0);
          } else {
            currentThresholdRef.current = nextThreshold;
            releaseThresholdRef.current = nextThreshold * THRESHOLD_RELEASE_FACTOR;
            setVoiceThreshold(nextThreshold);
            setMicrophoneCalibrationProgress(1);
          }

          resolve(
            buildCalibrationResult({
              status: nextStatus,
              noiseFloor,
              voiceLevel,
              voiceThreshold: nextStatus === 'error' ? currentThresholdRef.current : nextThreshold,
            })
          );
        }, maxWaitMs + durationMs + 400);

        calibrationRunRef.current = {
          mode,
          startedAt,
          sampleStartedAt: mode === 'voice' ? 0 : startedAt,
          durationMs,
          maxWaitMs,
          samples: [],
          voiceBurstMs: 0,
          nativeSamples: 0, firstNativeAt: 0, lastNativeAt: 0,
          timeout,
          resolve,
        };
      });
    },
    [hasNativeMeasurements]
  );

  const calibrateAmbientNoise = useCallback(
    (durationMs = 1800) => runMicrophoneCalibration('silence', durationMs).then(result => ({ ...result, measurement: measurementRef.current })),
    [runMicrophoneCalibration]
  );

  const calibrateVoiceLevel = useCallback(
    (durationMs = 3200) => runMicrophoneCalibration('voice', durationMs).then(result => ({ ...result, measurement: measurementRef.current })),
    [runMicrophoneCalibration]
  );

  const startListening = useCallback(async () => {
    if (!isListeningSupported) {
      const error = new Error('microphone-input-unsupported');
      microphoneInputFailureRef.current = error;
      setListeningStatus('unsupported');
      setListeningError(getMicrophoneInputErrorMessage(error));
      return;
    }

    if (listeningStatus === 'active' || listeningStatus === 'requesting') {
      return;
    }

    setListeningStatus('requesting');
    setListeningError(null);
    microphoneInputFailureRef.current = null;
    microphoneInputDiagnosticRef.current = { kind: 'microphone_input', stage: 'capture', status: 'ready',
      attempts: [], errorName: null, errorMessage: null };

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    let nativeStartedAt: number | null = null;
    try {
      const nativeInput = preferNativeInput ? getNativeLevelInput() : null;
      if (nativeInput) {
        const started = Date.now();
        nativeStartedAt = started;
        const capture = nativeInput.open(level => {
          if (requestVersionRef.current !== requestVersion) return;
          const at = getNow(); nativeSampleRef.current = { level, at };
          const run = calibrationRunRef.current;
          if (run) {
            run.nativeSamples++; if (!run.firstNativeAt) run.firstNativeAt = at; run.lastNativeAt = at;
            if (run.sampleStartedAt > 0) run.samples.push(level);
          }
        }, cause => {
          if (requestVersionRef.current !== requestVersion) return;
          microphoneInputFailureRef.current = cause;
          microphoneInputDiagnosticRef.current = { ...microphoneInputDiagnosticRef.current!, status: 'error', errorName: cause.name, errorMessage: cause.message.slice(0, 300) };
          void releaseListeningInput().catch(() => {});
        });
        nativeCaptureRef.current = capture;
        await waitForNativeLevelInput(capture.ready);
        if (requestVersionRef.current !== requestVersion) return;
        measurementRef.current = 'native_peak'; setMicrophoneCalibrationMeasurement('native_peak');
        microphoneInputDiagnosticRef.current = { ...microphoneInputDiagnosticRef.current!, attempts: [{ profile: 'native_peak', status: 'ready', elapsedMs: Date.now() - started, errorName: null, errorMessage: null }] };
        processedLineKeyRef.current = null; resetTrackingState(); setListeningStatus('active'); monitorSignal();
        return;
      }
      measurementRef.current = 'rms'; setMicrophoneCalibrationMeasurement('rms');
      const reusableStream = getReusableStream();
      const capture = reusableStream ? null : await captureMicrophoneInput({
        android: getMicrophoneInputContext().startsWith('android-'), preferredProfile: captureProfileRef.current,
        isCurrent: () => requestVersionRef.current === requestVersion,
        record: attempt => {
          const diagnostic = microphoneInputDiagnosticRef.current!;
          microphoneInputDiagnosticRef.current = { ...diagnostic, attempts: [...diagnostic.attempts, attempt] };
        },
      });
      const mediaStream = reusableStream ?? capture?.stream;
      if (!mediaStream) return;

      if (requestVersionRef.current !== requestVersion) {
        if (!reusableStream) mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (capture) captureProfileRef.current = capture.profile;
      // Own resources as soon as they are acquired, so a failed AudioContext
      // or graph cannot leave a physical microphone open during a retry.
      streamRef.current = mediaStream;
      microphoneInputDiagnosticRef.current = { ...microphoneInputDiagnosticRef.current!, stage: 'processor' };
      mediaStream.getAudioTracks().forEach((track) => {
        track.enabled = true;
      });

      const AudioContextConstructor = getAudioContextConstructor();
      if (!AudioContextConstructor) {
        throw new Error('audio-context-unavailable');
      }

      const audioContext = new AudioContextConstructor();
      audioContextRef.current = audioContext;
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // A release/new attempt can happen while resume() is pending. It owns
      // the cleanup; the cancelled attempt must not touch the new graph.
      if (requestVersionRef.current !== requestVersion) return;
      if (audioContext.state !== 'running') throw new Error('audio-context-not-running');

      const sourceNode = audioContext.createMediaStreamSource(mediaStream);
      sourceNodeRef.current = sourceNode;
      const analyser = audioContext.createAnalyser();
      analyserRef.current = analyser;
      analyser.fftSize = 2048;
      sourceNode.connect(analyser);

      samplesRef.current = new Uint8Array(analyser.fftSize);
      processedLineKeyRef.current = null;
      resetTrackingState();
      setListeningStatus('active');
      monitorSignal();
    } catch (error) {
      if (requestVersionRef.current !== requestVersion) return;
      try { await releaseListening(); } catch { /* The native controller keeps unconfirmed input closed to TTS/ASR. */ }
      if (requestVersionRef.current !== requestVersion + 1) return;
      microphoneInputFailureRef.current = asMicrophoneInputError(error);
      if (nativeStartedAt !== null && !microphoneInputDiagnosticRef.current?.attempts.length) {
        microphoneInputDiagnosticRef.current = { ...microphoneInputDiagnosticRef.current!, attempts: [{ profile: 'native_peak', status: 'error',
          elapsedMs: Math.max(0, Date.now() - nativeStartedAt), errorName: microphoneInputFailureRef.current.name.slice(0, 80),
          errorMessage: microphoneInputFailureRef.current.message.slice(0, 300) }] };
      }
      microphoneInputDiagnosticRef.current = { ...microphoneInputDiagnosticRef.current!, status: 'error',
        errorName: microphoneInputFailureRef.current.name.slice(0, 80),
        errorMessage: microphoneInputFailureRef.current.message.slice(0, 300) };
      setListeningError(getMicrophoneInputErrorMessage(error));
      setListeningStatus('error');
    }
  }, [
    getReusableStream,
    isListeningSupported,
    listeningStatus,
    monitorSignal,
    preferNativeInput,
    releaseListeningInput,
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
    microphoneCalibrationMeasurement,
    lineStateLabel,
    calibrateAmbientNoise,
    calibrateVoiceLevel,
    applyMicrophoneCalibration,
    resetMicrophoneCalibration,
    startListening,
    getMicrophoneInputFailure,
    getMicrophoneInputDiagnostic,
    stopListening,
    releaseListeningInput,
    releaseListening,
  };
};
