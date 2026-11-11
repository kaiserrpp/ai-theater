import { useEffect, useMemo, useState } from 'react';
import {
  createSpeechRecognitionSession,
  type SpeechRecognitionConstructor,
  type SpeechRecognitionSnapshot,
} from '../utils/speechRecognitionSession';
import { needsNaturalRecognitionEnd } from '../utils/speechRecognitionCompatibility';
import { prepareRecognitionRestart } from '../utils/rehearsalSpeech';
import { isPageVisible, observePageVisibility } from '../utils/pageVisibility';
import { getLocalSpeechRecognitionConstructor, preloadLocalSpeechRecognition } from '../utils/localSpeechRecognition';

type UseSpeechRecognitionOptions = {
  enabled: boolean;
  lang: string;
  lineKey: string | null;
  preferLocal?: boolean;
  prepareLocal?: boolean;
};

const getSpeechRecognitionConstructor = () => {
  if (typeof window === 'undefined') return null;
  const scopedWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scopedWindow.SpeechRecognition ?? scopedWindow.webkitSpeechRecognition ?? null;
};

export const useSpeechRecognition = ({ enabled, lang, lineKey, preferLocal = false, prepareLocal = false }: UseSpeechRecognitionOptions) => {
  const NativeConstructor = useMemo(getSpeechRecognitionConstructor, []);
  const LocalConstructor = useMemo(() => preferLocal ? getLocalSpeechRecognitionConstructor() : null, [preferLocal]);
  const Constructor = LocalConstructor ?? NativeConstructor;
  const isLocal = Boolean(LocalConstructor);
  const naturalEnd = useMemo(() => !isLocal && needsNaturalRecognitionEnd(typeof navigator === 'undefined' ? null : navigator), [isLocal]);
  const [snapshot, setSnapshot] = useState<SpeechRecognitionSnapshot>({
    status: Constructor ? 'idle' : 'unsupported', transcript: '', finalTranscript: '',
    interimTranscript: '', isAudioActive: false, hasReceivedTranscript: false, error: null, errorCode: null, errorDetail: null,
  });
  const session = useMemo(() => createSpeechRecognitionSession(Constructor, setSnapshot, {
    naturalEnd, prepareRestart: isLocal ? undefined : prepareRecognitionRestart,
    pageVisible: isPageVisible(), startTimeoutMs: isLocal ? 120000 : 15000,
  }), [Constructor, naturalEnd, isLocal]);

  useEffect(() => {
    if (isLocal && prepareLocal) void preloadLocalSpeechRecognition().catch(() => undefined);
  }, [isLocal, prepareLocal]);

  useEffect(() => observePageVisibility(session.setPageVisible), [session]);

  useEffect(() => {
    session.configure({ enabled, lang, lineKey });
  }, [enabled, lang, lineKey, session]);

  useEffect(() => () => session.dispose(), [session]);

  return {
    ...snapshot,
    isSupported: Boolean(Constructor),
    isLocal,
    resetTranscript: session.resetTranscript,
    activateRecognition: session.activate,
    restartRecognition: session.restart,
    stopRecognition: session.stop,
    waitForRecognitionEnd: session.waitForEnd,
    waitForRecognitionInputEnd: session.waitForInputEnd,
    getRecognitionInputEndReason: session.getInputEndReason,
    notifyRecognitionPlaybackEnd: session.notifyPlaybackEnd,
  };
};
