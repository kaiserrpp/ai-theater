import { useEffect, useRef } from 'react';
import { getNativePrototypeInfo } from '../utils/nativePrototype';
import { needsNaturalRecognitionEnd } from '../utils/speechRecognitionCompatibility';
import { isWarmupAdvanceCommand } from '../utils/voiceAdvance';
import { useSpeechRecognition } from './useSpeechRecognition';

export const useWarmupAdvance = (restKey: string | null, enabled: boolean, onAdvance: () => void) => {
  const advanceRef = useRef(onAdvance); advanceRef.current = onAdvance;
  const consumed = useRef<string | null>(null);
  const engine = !getNativePrototypeInfo() && needsNaturalRecognitionEnd(typeof navigator === 'undefined' ? null : navigator) ? 'vosk' : 'native';
  const recognition = useSpeechRecognition({ enabled: enabled && Boolean(restKey), lang: 'es-ES', lineKey: restKey,
    engine, prepareLocal: enabled });
  useEffect(() => {
    const utterance = recognition.lastUtterance;
    if (!enabled || !restKey || consumed.current === restKey || !utterance?.isFinal || utterance.lineKey !== restKey || !isWarmupAdvanceCommand(utterance.text)) return;
    consumed.current = restKey;
    advanceRef.current();
  }, [enabled, restKey, recognition.lastUtterance]);
  return recognition;
};
