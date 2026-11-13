import type { SpeechRecognitionConstructor } from './speechRecognitionSession';

export const getLocalSpeechRecognitionConstructor = (): SpeechRecognitionConstructor | null => null;
export const preloadLocalSpeechRecognition = async (): Promise<void> => {};
export const disposeLocalSpeechRecognition = () => {};
export const getSharedVoskModel = async (): Promise<import('./localSpeechRecognitionSession').LocalSpeechModel> => { throw new Error('Vosk solo está disponible en la web.'); };
