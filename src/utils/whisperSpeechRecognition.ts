import type { ScriptRecognitionContext } from './scriptRecognitionContext';
import type { SpeechRecognitionConstructor } from './speechRecognitionSession';
import type { RecognitionProcessingTiming } from '../types/sharedScript';
export const getWhisperSpeechRecognitionConstructor = (_getContext: () => ScriptRecognitionContext | undefined, _getLanguage?: () => string, _onTiming?: (timing: RecognitionProcessingTiming | null) => void): SpeechRecognitionConstructor | null => null;
export const preloadWhisperSpeechRecognition = async () => {};
export const disposeWhisperSpeechRecognition = () => {};
