import { useEffect, useMemo, useRef } from 'react';
import { getNativePrototypeInfo } from '../utils/nativePrototype';
import { usesWarmupMicrophoneSession } from '../utils/warmupMicrophoneSession';
import { createWarmupSpeechInput } from '../utils/warmupSpeechInput';
import { observePageVisibility } from '../utils/pageVisibility';
import { useSpeechRecognition } from './useSpeechRecognition';

export const useVoiceCommand = (restKey: string | null, enabled: boolean, onAdvance: () => void, accepts: (text: string) => boolean) => {
  const advanceRef = useRef(onAdvance); advanceRef.current = onAdvance;
  const consumed = useRef<string | null>(null);
  useEffect(() => { if (!enabled || !restKey) consumed.current = null; }, [enabled, restKey]);
  const local = usesWarmupMicrophoneSession(typeof navigator === 'undefined' ? null : navigator, Boolean(getNativePrototypeInfo()));
  const input = useMemo(() => local ? createWarmupSpeechInput() : null, [local]);
  const engine = local ? 'vosk' : 'native';
  const recognition = useSpeechRecognition({ enabled: enabled && Boolean(restKey), lang: 'es-ES', lineKey: restKey,
    engine, localConstructor: local ? input?.Constructor ?? null : undefined, prepareLocal: enabled,
    // iOS continuous recognition can keep a whole command provisional until
    // the service stops. Let commands finish naturally, never actor turns.
    continuous: getNativePrototypeInfo()?.platform === 'ios' ? false : undefined });
  useEffect(() => { if (!enabled) input?.release(); }, [enabled, input]);
  useEffect(() => {
    const unobserve = observePageVisibility(visible => { if (!visible) input?.release(); });
    return () => { unobserve(); input?.release(); };
  }, [input]);
  useEffect(() => {
    const utterance = recognition.lastUtterance;
    if (!enabled || !restKey || consumed.current === restKey || !utterance?.isFinal || utterance.lineKey !== restKey || !accepts(utterance.text)) return;
    consumed.current = restKey;
    advanceRef.current();
  }, [enabled, restKey, recognition.lastUtterance, accepts]);
  return { ...recognition,
    prepareVoiceInput: () => { void input?.prepare(true).catch(() => undefined); },
    releaseVoiceInput: () => { recognition.stopRecognition(); input?.release(); },
    restartRecognition: () => { void input?.prepare(true).catch(() => undefined); recognition.restartRecognition(); },
  };
};
