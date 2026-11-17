import { normalizeSpeechText } from './lineMatching';

// Match the entire utterance: conversation, negations and announcement echoes
// must never be interpreted as a command hidden inside a longer sentence.
export const isWarmupAdvanceCommand = (text: string) => ['adelante', 'siguiente'].includes(normalizeSpeechText(text));
export const isHomeRehearsalCommand = (text: string) => normalizeSpeechText(text) === 'ensayo';
