import type { SpeechRecognitionConstructor } from './speechRecognitionSession';

export const createWarmupSpeechInput = (): {
  Constructor: SpeechRecognitionConstructor;
  prepare: (retry?: boolean) => Promise<void>;
  release: () => void;
} | null => null;
