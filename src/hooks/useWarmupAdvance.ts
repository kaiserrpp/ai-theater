import { useEffect, useMemo, useRef } from 'react';
import { getNativePrototypeInfo } from '../utils/nativePrototype';
import { usesWarmupMicrophoneSession } from '../utils/warmupMicrophoneSession';
import { createWarmupSpeechInput } from '../utils/warmupSpeechInput';
import { observePageVisibility } from '../utils/pageVisibility';
import { isWarmupAdvanceCommand } from '../utils/voiceAdvance';
import { useSpeechRecognition } from './useSpeechRecognition';

export const useWarmupAdvance = (restKey: string | null, enabled: boolean, onAdvance: () => void) => {
  const advanceRef = useRef(onAdvance); advanceRef.current = onAdvance;
  const consumed = useRef<string | null>(null);
  const local = usesWarmupMicrophoneSession(typeof navigator === 'undefined' ? null : navigator, Boolean(getNativePrototypeInfo()));
  const input = useMemo(() => local ? createWarmupSpeechInput() : null, [local]);
  const engine = local ? 'vosk' : 'native';
  const recognition = useSpeechRecognition({ enabled: enabled && Boolean(restKey), lang: 'es-ES', lineKey: restKey,
    engine, localConstructor: local ? input?.Constructor ?? null : undefined, prepareLocal: enabled });
  useEffect(() => { if (!enabled) input?.release(); }, [enabled, input]);
  useEffect(() => {
    const unobserve = observePageVisibility(visible => { if (!visible) input?.release(); });
    return () => { unobserve(); input?.release(); };
  }, [input]);
  useEffect(() => {
    const utterance = recognition.lastUtterance;
    if (!enabled || !restKey || consumed.current === restKey || !utterance?.isFinal || utterance.lineKey !== restKey || !isWarmupAdvanceCommand(utterance.text)) return;
    consumed.current = restKey;
    advanceRef.current();
  }, [enabled, restKey, recognition.lastUtterance]);
  return { ...recognition,
    prepareWarmupMicrophone: () => { void input?.prepare(true).catch(() => undefined); },
    releaseWarmupMicrophone: () => { recognition.stopRecognition(); input?.release(); },
    restartRecognition: () => { void input?.prepare(true).catch(() => undefined); recognition.restartRecognition(); },
  };
};
