export type ListenPreference = 'intelligent' | 'manual' | 'auto';

export const resolveListenPreference = (stored: string | null, supported: boolean): ListenPreference => {
  if (stored === 'manual' || stored === 'auto') return stored;
  return supported ? 'intelligent' : 'manual';
};
// Only an explicit opt-out hides the transcript, including after upgrades.
export const resolveTranscriptPreference = (stored: string | null) => stored !== 'false';
export const supportsRecognition = () => typeof window !== 'undefined' && Boolean(
  (window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ||
  (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
);
