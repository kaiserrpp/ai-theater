import { useEffect, useMemo } from 'react';
import { getNativePrototypeInfo } from '../utils/nativePrototype';
import { usesWarmupMicrophoneSession } from '../utils/warmupMicrophoneSession';
import { createWarmupSpeechInput } from '../utils/warmupSpeechInput';
import { observePageVisibility } from '../utils/pageVisibility';
import { useSpeechRecognition } from './useSpeechRecognition';

export const useVoiceCommand = (restKey: string | null, enabled: boolean, onAdvance: () => void, accepts: (text: string) => boolean) => {
  const nativeHost = getNativePrototypeInfo();
  const local = usesWarmupMicrophoneSession(typeof navigator === 'undefined' ? null : navigator, Boolean(nativeHost));
  const input = useMemo(() => local ? createWarmupSpeechInput() : null, [local]);
  const engine = local ? 'vosk' : 'native';
  // The installed iPhone can keep a whole command provisional in continuous mode.
  const continuous = nativeHost?.platform === 'ios' ? false : undefined;
  const recognition = useSpeechRecognition({ enabled: enabled && Boolean(restKey), lang: 'es-ES', lineKey: restKey,
    engine, localConstructor: local ? input?.Constructor ?? null : undefined, prepareLocal: enabled,
    continuous, command: { accepts, onRecognized: onAdvance } });
  useEffect(() => { if (!enabled) input?.release(); }, [enabled, input]);
  useEffect(() => {
    const unobserve = observePageVisibility(visible => { if (!visible) input?.release(); });
    return () => { unobserve(); input?.release(); };
  }, [input]);
  return { ...recognition,
    prepareVoiceInput: () => { void input?.prepare(true).catch(() => undefined); },
    releaseVoiceInput: () => { recognition.stopRecognition(); input?.release(); },
    restartRecognition: () => {
      if (!restKey) return;
      void input?.prepare(true).catch(() => undefined);
      recognition.activateRecognition({ lang: 'es-ES', lineKey: restKey, continuous });
    },
  };
};
