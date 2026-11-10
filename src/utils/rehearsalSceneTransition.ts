import type { Dialogue } from '../types/script';
import { normalizeSpeechText } from './lineMatching';
import { isSceneMarker } from './scriptScenes';

// Every automatic source (dialogue, silence and music) must stop at a scene.
export const getAutomaticRehearsalTargetIndex = (
  lines: Dialogue[],
  currentIndex: number,
  targetIndex = currentIndex + 1
) => {
  const target = Math.min(targetIndex, lines.length);
  if (target <= currentIndex) return currentIndex;

  for (let index = currentIndex; index <= target; index += 1) {
    if (isSceneMarker(lines[index])) return index;
  }

  return target;
};

export const isSceneAdvanceCommand = (text: string) => normalizeSpeechText(text) === 'adelante';

type AnnouncementOptions = {
  title: string;
  releaseInput: () => Promise<void>;
  speak: (text: string, callbacks: { onDone: () => void; onError: (error: Error) => void }) => void;
  stop: () => void;
  onReady: (error: Error | null) => void;
};

// Completing an announcement only arms the command; it never starts the scene.
export const startRehearsalSceneAnnouncement = ({
  title, releaseInput, speak, stop, onReady,
}: AnnouncementOptions) => {
  let cancelled = false;
  let finished = false;
  const finish = (error: Error | null = null) => {
    if (cancelled || finished) return;
    finished = true;
    onReady(error);
  };

  void releaseInput().then(() => {
    if (cancelled) return;
    speak(`Siguiente escena: ${title}`, { onDone: () => finish(), onError: finish });
  }).catch((error: unknown) => finish(error instanceof Error ? error : new Error('scene-announcement-error')));

  return () => {
    cancelled = true;
    stop();
  };
};
