import type { MicrophoneCalibrationResult } from '../hooks/useSilenceAdvance';
import type { ListenPreference } from './rehearsalPreferences';

export interface RehearsalPreparationEvidence {
  speakerConfirmed: boolean;
  microphoneCalibrated: boolean;
  recognitionAudioActive: boolean;
  speakerWithRecognitionConfirmed: boolean;
}

export const canBeginPreparedRehearsal = (mode: ListenPreference, evidence: RehearsalPreparationEvidence) =>
  evidence.speakerConfirmed && (mode === 'manual' || (
    evidence.microphoneCalibrated && (mode === 'auto' || (
      evidence.recognitionAudioActive && evidence.speakerWithRecognitionConfirmed
    ))
  ));

export const runRehearsalMicrophoneCalibration = async (operations: {
  isCurrent: () => boolean;
  prepareOutput: () => Promise<void>;
  start: () => Promise<void>;
  measureNoise: () => Promise<MicrophoneCalibrationResult>;
  prompt: () => Promise<void>;
  beep: () => Promise<void>;
  measureVoice: () => Promise<MicrophoneCalibrationResult>;
  release: () => Promise<void>;
  onStage: (stage: 'silence' | 'prompt' | 'voice') => void;
}) => {
  const checkCurrent = () => {
    if (!operations.isCurrent()) throw new Error('preparation-cancelled');
  };
  try {
    checkCurrent();
    await operations.prepareOutput();
    checkCurrent();
    await operations.start();
    checkCurrent();
    operations.onStage('silence');
    const noise = await operations.measureNoise();
    checkCurrent();
    if (noise.status !== 'ready' && noise.status !== 'weak') throw new Error('microphone-unavailable');
    operations.onStage('prompt');
    await operations.prompt();
    checkCurrent();
    await operations.beep();
    checkCurrent();
    operations.onStage('voice');
    const voice = await operations.measureVoice();
    checkCurrent();
    if ((voice.status !== 'ready' && voice.status !== 'weak') || voice.voiceLevel <= 0) throw new Error('voice-not-detected');
    return voice;
  } finally {
    // Release the calibration capture before opening speech recognition. A
    // cancelled run must not close a newer run's microphone.
    if (operations.isCurrent()) await operations.release();
  }
};
