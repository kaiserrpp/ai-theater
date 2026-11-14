import { asMicrophoneInputError } from './microphoneInputHelp';

export type MicrophoneCaptureProfile = 'processed' | 'unprocessed';
export type MicrophoneCaptureAttempt = {
  profile: MicrophoneCaptureProfile; status: 'ready' | 'error'; elapsedMs: number;
  errorName: string | null; errorMessage: string | null;
};
export type MicrophoneInputDiagnostic = {
  kind: 'microphone_input'; stage: 'capture' | 'processor'; status: 'ready' | 'error';
  attempts: MicrophoneCaptureAttempt[]; errorName: string | null; errorMessage: string | null;
};

export const captureMicrophoneInput = async (options: {
  android: boolean; preferredProfile: MicrophoneCaptureProfile; isCurrent: () => boolean;
  record: (attempt: MicrophoneCaptureAttempt) => void;
}): Promise<{ stream: MediaStream; profile: MicrophoneCaptureProfile } | null> => {
  const profiles: MicrophoneCaptureProfile[] = options.android && options.preferredProfile === 'processed'
    ? ['processed', 'unprocessed'] : [options.preferredProfile];
  for (const profile of profiles) {
    if (!options.isCurrent()) return null;
    const started = Date.now();
    try {
      const enabled = profile === 'processed';
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: enabled, noiseSuppression: enabled, autoGainControl: enabled,
      } });
      if (!options.isCurrent()) { stream.getTracks().forEach(track => track.stop()); return null; }
      options.record({ profile, status: 'ready', elapsedMs: Math.max(0, Date.now() - started), errorName: null, errorMessage: null });
      return { stream, profile };
    } catch (cause) {
      if (!options.isCurrent()) return null;
      const error = asMicrophoneInputError(cause);
      options.record({ profile, status: 'error', elapsedMs: Math.max(0, Date.now() - started),
        errorName: error.name.slice(0, 80), errorMessage: error.message.slice(0, 300) });
      // Only a failed Android device/processing start gets one simpler attempt.
      // Permission denials, other platforms and cancelled requests never retry.
      if (profile !== 'processed' || profiles.length < 2 ||
        !['NotReadableError', 'TrackStartError', 'AbortError', 'OverconstrainedError'].includes(error.name)) throw error;
    }
  }
  return null;
};
