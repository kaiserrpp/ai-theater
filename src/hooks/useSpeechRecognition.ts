import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createSpeechRecognitionSession,
  type SpeechRecognitionConstructor,
  type SpeechRecognitionSnapshot,
} from '../utils/speechRecognitionSession';
import { needsNaturalRecognitionEnd } from '../utils/speechRecognitionCompatibility';
import { prepareRecognitionRestart } from '../utils/rehearsalSpeech';
import { isPageVisible, observePageVisibility } from '../utils/pageVisibility';
import { getLocalSpeechRecognitionConstructor, preloadLocalSpeechRecognition, disposeLocalSpeechRecognition } from '../utils/localSpeechRecognition';
import { getWhisperSpeechRecognitionConstructor, preloadWhisperSpeechRecognition, disposeWhisperSpeechRecognition } from '../utils/whisperSpeechRecognition';
import type { RecognitionEngine, ScriptRecognitionContext } from '../utils/scriptRecognitionContext';
import type { RecognitionProcessingTiming } from '../types/sharedScript';

type UseSpeechRecognitionOptions = {
  enabled: boolean;
  lang: string;
  lineKey: string | null;
  preferLocal?: boolean;
  prepareLocal?: boolean;
  engine?: RecognitionEngine;
  context?: ScriptRecognitionContext;
  whisperLanguage?: 'auto' | 'spanish' | 'english';
  whisperMicrophoneCheck?: boolean;
  whisperSpeechThreshold?: number;
};

const getSpeechRecognitionConstructor = () => {
  if (typeof window === 'undefined') return null;
  const scopedWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return scopedWindow.SpeechRecognition ?? scopedWindow.webkitSpeechRecognition ?? null;
};

export const useSpeechRecognition = ({ enabled, lang, lineKey, preferLocal = false, prepareLocal = false, engine = 'vosk', context, whisperLanguage = 'auto', whisperMicrophoneCheck = false, whisperSpeechThreshold = 0.0001 }: UseSpeechRecognitionOptions) => {
  const contextRef = useRef(context); contextRef.current = context;
  const whisperLanguageRef = useRef(whisperLanguage); whisperLanguageRef.current = whisperLanguage;
  const microphoneCheckRef = useRef(whisperMicrophoneCheck); microphoneCheckRef.current = whisperMicrophoneCheck;
  const speechThresholdRef = useRef(whisperSpeechThreshold); speechThresholdRef.current = whisperSpeechThreshold;
  const processingTimingRef = useRef<RecognitionProcessingTiming | null>(null);
  const getRecognitionProcessingTiming = useCallback(() => processingTimingRef.current, []);
  const NativeConstructor = useMemo(getSpeechRecognitionConstructor, []);
  const LocalConstructor = useMemo(() => engine === 'whisper' ? getWhisperSpeechRecognitionConstructor(() => contextRef.current, () => whisperLanguageRef.current, timing => { processingTimingRef.current = timing; }, () => microphoneCheckRef.current, () => speechThresholdRef.current) :
    preferLocal ? getLocalSpeechRecognitionConstructor() : null, [engine, preferLocal]);
  const Constructor = engine === 'whisper' ? LocalConstructor : LocalConstructor ?? NativeConstructor;
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
    if (engine === 'whisper') disposeLocalSpeechRecognition();
    if (isLocal && prepareLocal) void (engine === 'whisper' ? preloadWhisperSpeechRecognition() : preloadLocalSpeechRecognition()).catch(() => undefined);
  }, [isLocal, prepareLocal, engine]);

  useEffect(() => observePageVisibility(session.setPageVisible), [session]);

  useEffect(() => {
    processingTimingRef.current = null;
    session.configure({ enabled, lang, lineKey });
  }, [enabled, lang, lineKey, session]);

  useEffect(() => () => {
    session.dispose();
    if (engine === 'whisper') disposeWhisperSpeechRecognition();
  }, [session, engine]);

  return {
    ...snapshot,
    isSupported: Boolean(Constructor),
    isLocal,
    getRecognitionProcessingTiming,
    resetTranscript: session.resetTranscript,
    finishRecognitionInput: session.finishInput,
    activateRecognition: session.activate,
    restartRecognition: session.restart,
    stopRecognition: session.stop,
    waitForRecognitionEnd: session.waitForEnd,
    waitForRecognitionInputEnd: session.waitForInputEnd,
    getRecognitionInputEndReason: session.getInputEndReason,
    notifyRecognitionPlaybackEnd: session.notifyPlaybackEnd,
  };
};
