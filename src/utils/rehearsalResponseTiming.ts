import type { RehearsalResponseTiming } from '../types/sharedScript';

// Browser events locate app/recognizer/TTS waits, not physical audible onset.
export const getRehearsalResponseTiming = (matchCreatedAt: string, playbackEffectAt: number,
  inputClosedAt: number, voiceRequestedAt: number, voiceStartEventAt: number): RehearsalResponseTiming | null => {
  const matchedAt = Date.parse(matchCreatedAt);
  if (![matchedAt, playbackEffectAt, inputClosedAt, voiceRequestedAt, voiceStartEventAt].every(Number.isFinite) ||
    playbackEffectAt < matchedAt || inputClosedAt < playbackEffectAt ||
    voiceRequestedAt < inputClosedAt || voiceStartEventAt < voiceRequestedAt) return null;
  return { kind: 'browser_events', matchToVoiceRequestMs: voiceRequestedAt - matchedAt,
    matchToVoiceStartEventMs: voiceStartEventAt - matchedAt,
    inputCloseMs: inputClosedAt - playbackEffectAt, voiceRequestToStartEventMs: voiceStartEventAt - voiceRequestedAt };
};
