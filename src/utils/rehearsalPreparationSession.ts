import type { MicrophoneCalibrationSnapshot } from '../hooks/useSilenceAdvance';
import type { ListenPreference } from './rehearsalPreferences';
import { hasRecognizedMicrophoneCheck } from './speechRecognitionCompatibility';

export interface RehearsalPreparationSnapshot {
  readonly speakerConfirmed: boolean;
  readonly calibration: Readonly<MicrophoneCalibrationSnapshot> | null;
  readonly recognitionOutputConfirmed: boolean;
  readonly remember: boolean;
  readonly loaded: boolean;
  readonly storageError: string | null;
}

export type PreparationStorage = {
  key: string; context: string;
  read: (key: string) => Promise<string | null>;
  write: (key: string, value: string) => Promise<void>;
};
const engines = new Set(['default', 'native', 'vosk', 'whisper']);
const validCalibration = (value: MicrophoneCalibrationSnapshot | null | undefined) => Boolean(value &&
  (value.status === 'ready' || value.status === 'weak') &&
  (value.measurement === undefined || value.measurement === 'rms' || value.measurement === 'native_peak') &&
  Number.isFinite(value.noiseFloor) && value.noiseFloor >= 0 && value.noiseFloor <= 1 &&
  Number.isFinite(value.voiceLevel) && value.voiceLevel > 0 && value.voiceLevel <= 1 &&
  Number.isFinite(value.voiceThreshold) && value.voiceThreshold > 0 && value.voiceThreshold <= 1);
const calibrationData = (value: Readonly<MicrophoneCalibrationSnapshot> | null) => value ? {
  status: value.status, measurement: value.measurement || 'rms', noiseFloor: value.noiseFloor,
  voiceLevel: value.voiceLevel, voiceThreshold: value.voiceThreshold,
} : null;

// Remember completed checks, never a live capture or a permission grant. Every
// rehearsal still opens its real input and observes its current start/errors.
export const createRehearsalPreparationSession = (initialStorage?: PreparationStorage) => {
  let storage = initialStorage;
  const empty = (remember = true, loaded = !storage): RehearsalPreparationSnapshot => Object.freeze({
    speakerConfirmed: false, calibration: null, recognitionOutputConfirmed: false,
    remember, loaded, storageError: null,
  });
  let snapshot = empty();
  let generation = 0;
  let loading: Promise<void> | null = null;
  let writes = Promise.resolve();
  const confirmedRecognitionEngines = new Set<string>();
  const listeners = new Set<() => void>();
  const update = (next: RehearsalPreparationSnapshot) => {
    snapshot = Object.freeze(next);
    listeners.forEach((listener) => listener());
  };
  const persist = () => {
    if (!storage) return;
    const target = storage;
    const payload = JSON.stringify({ version: 1, context: target.context, remember: snapshot.remember,
      speakerConfirmed: snapshot.remember && snapshot.speakerConfirmed,
      calibration: snapshot.remember ? calibrationData(snapshot.calibration) : null,
      engines: snapshot.remember ? [...confirmedRecognitionEngines] : [],
    });
    writes = writes.catch(() => {}).then(() => target.write(target.key, payload)).then(() => {
      if (storage === target && snapshot.storageError) update({ ...snapshot, storageError: null });
    }).catch(() => {
      if (storage === target) update({ ...snapshot, storageError: 'La configuración sigue activa, pero no se pudo guardar en este dispositivo.' });
    });
  };
  const change = (next: RehearsalPreparationSnapshot) => { generation++; update(next); persist(); };
  const load = (): Promise<void> => {
    if (!storage) return Promise.resolve();
    if (loading) return loading;
    const target = storage, version = generation;
    loading = target.read(target.key).then(raw => {
      if (storage !== target || generation !== version) return;
      if (!raw) { update({ ...snapshot, loaded: true }); return; }
      const value = JSON.parse(raw);
      if (value?.version !== 1 || value.context !== target.context || typeof value.remember !== 'boolean' ||
        typeof value.speakerConfirmed !== 'boolean' || !Array.isArray(value.engines) ||
        value.engines.some((engine: unknown) => typeof engine !== 'string' || !engines.has(engine)) ||
        (value.calibration !== null && !validCalibration(value.calibration)) ||
        (value.engines.length && !value.speakerConfirmed)) throw new Error('invalid-preparation');
      if (!value.remember) { confirmedRecognitionEngines.clear(); update(empty(false, true)); return; }
      value.engines.forEach((engine: string) => confirmedRecognitionEngines.add(engine));
      update({ speakerConfirmed: value.speakerConfirmed,
        calibration: value.calibration ? Object.freeze(calibrationData(value.calibration)!) : null,
        recognitionOutputConfirmed: confirmedRecognitionEngines.size > 0, remember: true, loaded: true, storageError: null });
    }).catch(() => {
      if (storage === target && generation === version) update({ ...snapshot, loaded: true,
        storageError: 'No se pudo recuperar la configuración de audio. Puedes repetir las pruebas.' });
      loading = null;
    }).finally(() => {
      if (storage === target && !snapshot.loaded) update({ ...snapshot, loaded: true });
    });
    return loading;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load,
    configurePersistence: (next: PreparationStorage) => {
      if (storage?.key === next.key) return;
      const previous = storage; storage = next; loading = null;
      if (previous) { generation++; confirmedRecognitionEngines.clear(); update(empty()); }
      else if (snapshot.speakerConfirmed || snapshot.calibration) { generation++; update({ ...snapshot, loaded: true }); persist(); }
      else update({ ...snapshot, loaded: false });
    },
    flush: () => writes,
    setRemember: (remember: boolean) => change({ ...snapshot, remember }),
    confirmSpeaker: () => change({ ...snapshot, speakerConfirmed: true }),
    resetCalibration: () => change({ ...snapshot, calibration: null }),
    rememberCalibration: (calibration: MicrophoneCalibrationSnapshot) => {
      if (!validCalibration(calibration)) return;
      change({ ...snapshot, calibration: Object.freeze({ ...calibration }) });
    },
    confirmRecognitionOutput: (heardText = '', engine = 'default') => {
      if (snapshot.speakerConfirmed && snapshot.calibration && engines.has(engine) && hasRecognizedMicrophoneCheck(heardText)) {
        confirmedRecognitionEngines.add(engine);
        change({ ...snapshot, recognitionOutputConfirmed: true });
      }
    },
    hasConfirmedRecognitionEngine: (engine: string) => confirmedRecognitionEngines.has(engine),
    reset: () => { confirmedRecognitionEngines.clear(); change(empty(snapshot.remember, snapshot.loaded)); },
  };
};

export const getRehearsalPreparationStep = (mode: ListenPreference, snapshot: RehearsalPreparationSnapshot) => {
  if (!snapshot.speakerConfirmed) return 'speaker';
  if (mode !== 'manual' && !snapshot.calibration) return 'microphone';
  // Recognition must be activated again and report live audio in each rehearsal.
  if (mode === 'intelligent') return 'recognition';
  return 'ready';
};

export const rehearsalPreparationSession = createRehearsalPreparationSession();
