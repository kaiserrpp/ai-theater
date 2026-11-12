import type { ScriptRecognitionContext } from './scriptRecognitionContext';
import type { SpeechRecognitionConstructor } from './speechRecognitionSession';
export const getWhisperSpeechRecognitionConstructor = (_getContext: () => ScriptRecognitionContext | undefined): SpeechRecognitionConstructor | null => null;
export const preloadWhisperSpeechRecognition = async () => {};
export const disposeWhisperSpeechRecognition = () => {};
