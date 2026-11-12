// This threshold only segments decoded audio. It never gates recording or
// decides whether an actor's replica is accepted.
export const getWhisperSegmentationThreshold = (noiseFloor: number, voiceLevel: number) => {
  if (!Number.isFinite(voiceLevel) || voiceLevel <= 0) return 0.0001;
  const noise = Number.isFinite(noiseFloor) ? Math.max(0, noiseFloor) : 0;
  return Math.max(0.0001, Math.min(voiceLevel * 0.5, Math.max(noise * 1.5, voiceLevel * 0.15)));
};
