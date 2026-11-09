import type { MicrophoneCalibrationSnapshot } from '../hooks/useSilenceAdvance';
import type { ListenPreference } from './rehearsalPreferences';

export interface RehearsalPreparationSnapshot {
  readonly speakerConfirmed: boolean;
  readonly calibration: Readonly<MicrophoneCalibrationSnapshot> | null;
  readonly recognitionOutputConfirmed: boolean;
}

// Deliberately memory-only: leaving a rehearsal keeps the checks, closing or
// reloading the app creates a new session. Never retain an open microphone here.
export const createRehearsalPreparationSession = () => {
  const empty = (): RehearsalPreparationSnapshot => Object.freeze({
    speakerConfirmed: false, calibration: null, recognitionOutputConfirmed: false,
  });
  let snapshot = empty();
  const listeners = new Set<() => void>();
  const update = (next: RehearsalPreparationSnapshot) => {
    snapshot = Object.freeze(next);
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    confirmSpeaker: () => update({ ...snapshot, speakerConfirmed: true }),
    rememberCalibration: (calibration: MicrophoneCalibrationSnapshot) => {
      if ((calibration.status !== 'ready' && calibration.status !== 'weak') ||
        !Number.isFinite(calibration.noiseFloor) || calibration.noiseFloor < 0 ||
        !Number.isFinite(calibration.voiceLevel) || calibration.voiceLevel <= 0 ||
        !Number.isFinite(calibration.voiceThreshold) || calibration.voiceThreshold <= 0) return;
      update({ ...snapshot, calibration: Object.freeze({ ...calibration }) });
    },
    confirmRecognitionOutput: () => {
      if (snapshot.speakerConfirmed && snapshot.calibration) {
        update({ ...snapshot, recognitionOutputConfirmed: true });
      }
    },
    reset: () => update(empty()),
  };
};

export const getRehearsalPreparationStep = (mode: ListenPreference, snapshot: RehearsalPreparationSnapshot) => {
  if (mode !== 'manual' && !snapshot.calibration) return 'microphone';
  if (!snapshot.speakerConfirmed) return 'speaker';
  // Recognition must be activated again and report live audio in each rehearsal.
  if (mode === 'intelligent') return 'recognition';
  return 'ready';
};

export const rehearsalPreparationSession = createRehearsalPreparationSession();
