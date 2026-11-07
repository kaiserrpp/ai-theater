import { useEffect, useMemo, useState } from 'react';
import {
  createSpeechRecognitionSession,
  type SpeechRecognitionConstructor,
  type SpeechRecognitionSnapshot,
} from '../utils/speechRecognitionSession';

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
  const [snapshot, setSnapshot] = useState<SpeechRecognitionSnapshot>({
    status: Constructor ? 'idle' : 'unsupported', transcript: '', finalTranscript: '',
    interimTranscript: '', isAudioActive: false, error: null,
  });
  const session = useMemo(() => createSpeechRecognitionSession(Constructor, setSnapshot), [Constructor]);

  useEffect(() => {
    session.configure({ enabled, lang, lineKey });
  }, [enabled, lang, lineKey, session]);

  useEffect(() => () => session.dispose(), [session]);

  return {
    ...snapshot,
    isSupported: Boolean(Constructor),
    resetTranscript: session.resetTranscript,
    restartRecognition: session.restart,
    stopRecognition: session.stop,
  };
};
