import { buildNativeRecognitionPlan } from '../nativePrototype/recognitionHints';
import { inferSpeechRecognitionLanguage } from './lineMatching';

export const buildRehearsalRecognitionPlan = (text: string, context: { names: string[]; vocabulary: string[] },
  engine: string, nativeHintsEnabled: boolean) => {
  const legacy = inferSpeechRecognitionLanguage(text);
  if (engine !== 'native') return { lang: legacy, hints: undefined };
  const plan = buildNativeRecognitionPlan(text, context, legacy);
  return { lang: plan.lang, hints: nativeHintsEnabled ? plan.hints : undefined };
};
