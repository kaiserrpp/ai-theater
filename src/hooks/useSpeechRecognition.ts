import { useEffect, useMemo, useState } from 'react';
import {
  createSpeechRecognitionSession,
  type SpeechRecognitionConstructor,
  type SpeechRecognitionSnapshot,
} from '../utils/speechRecognitionSession';
import { needsNaturalRecognitionEnd } from '../utils/speechRecognitionCompatibility';
import { prepareRecognitionRestart } from '../utils/rehearsalSpeech';
import { isPageVisible, observePageVisibility } from '../utils/pageVisibility';

type UseSpeechRecognitionOptions = {
  enabled: boolean;
  lang: string;
  lineKey: string | null;
};

const getSpeechRecognitionConstructor = () => {
  if (typeof window === 'undefined') return null;
  const scopedWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scopedWindow.SpeechRecognition ?? scopedWindow.webkitSpeechRecognition ?? null;
};

export const useSpeechRecognition = ({ enabled, lang, lineKey }: UseSpeechRecognitionOptions) => {
  const Constructor = useMemo(getSpeechRecognitionConstructor, []);
  const naturalEnd = useMemo(() => needsNaturalRecognitionEnd(typeof navigator === 'undefined' ? null : navigator), []);
  const [snapshot, setSnapshot] = useState<SpeechRecognitionSnapshot>({
    status: Constructor ? 'idle' : 'unsupported', transcript: '', finalTranscript: '',
    interimTranscript: '', isAudioActive: false, hasReceivedTranscript: false, error: null, errorCode: null, errorDetail: null,
  });
  const session = useMemo(() => createSpeechRecognitionSession(Constructor, setSnapshot, {
    naturalEnd, prepareRestart: prepareRecognitionRestart, pageVisible: isPageVisible(),
  }), [Constructor, naturalEnd]);

  useEffect(() => observePageVisibility(session.setPageVisible), [session]);

  useEffect(() => {
    session.configure({ enabled, lang, lineKey });
  }, [enabled, lang, lineKey, session]);

  useEffect(() => () => session.dispose(), [session]);

  return {
    ...snapshot,
    isSupported: Boolean(Constructor),
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
