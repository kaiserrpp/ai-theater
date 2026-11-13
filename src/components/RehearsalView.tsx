import AsyncStorage from '@react-native-async-storage/async-storage';
import packageInfo from '../../package.json';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { submitIntelligentLineFeedback } from '../api/sharedScripts';
import { useSilenceAdvance } from '../hooks/useSilenceAdvance';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useRehearsalComparison } from '../hooks/useRehearsalComparison';
import type { RehearsalComparisonResult } from '../utils/rehearsalComparisonSession';
import { makeRehearsalComparisonEntry, type ComparisonLineMetadata } from '../utils/rehearsalComparisonFeedback';
import { usePageVisibility } from '../hooks/usePageVisibility';
import { isPageVisible } from '../utils/pageVisibility';
import { SpeechRecognitionErrorPanel } from './SpeechRecognitionErrorPanel';
import { MicrophoneSettings } from './MicrophoneSettings';
import { Button, Chip, Icon, Sheet, usePracticeTheme } from './PracticeUI';
import type { PracticePalette } from '../utils/appearance';
import { resolveListenPreference, resolveTranscriptPreference, supportsRecognition } from '../utils/rehearsalPreferences';
import { canBeginPreparedRehearsal, runRehearsalMicrophoneCalibration } from '../utils/rehearsalPreparation';
import { playCalibrationBeep, playCalibrationVoice, primeRehearsalAudioPlayer } from '../utils/rehearsalCalibrationAudio';
import { getRehearsalPreparationStep, rehearsalPreparationSession } from '../utils/rehearsalPreparationSession';
import { hasRecognizedMicrophoneCheck } from '../utils/speechRecognitionCompatibility';
import { buildScriptRecognitionContext, resolveRecognitionEngine, usesWhisperRecognition, type RecognitionEngine } from '../utils/scriptRecognitionContext';
import {
  INTELLIGENT_LINE_VARIANTS_STORAGE_PREFIX,
  LEGACY_REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY,
  REHEARSAL_AUDIO_SELECTION_STORAGE_PREFIX,
  REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY,
  REHEARSAL_AUDIO_MODE_STORAGE_KEY,
  REHEARSAL_LISTEN_MODE_STORAGE_KEY,
  REHEARSAL_RECOGNITION_ENGINE_STORAGE_KEY,
  REHEARSAL_TRANSCRIPT_STORAGE_KEY,
} from '../store/storageKeys';
import { Dialogue } from '../types/script';
import {
  MusicalTimelineCue,
  MusicalTimelineCueTargetKind,
  SharedMusicalNumberAsset,
  SharedSongAsset,
  SharedSongAudioAsset,
  SharedSongAudioKind,
  IntelligentLineFeedbackEntry,
  IntelligentLineFeedbackIssueType,
  IntelligentLineFeedbackResult,
} from '../types/sharedScript';
import {
  INTELLIGENT_AUTO_ADVANCE_THRESHOLD,
  getAutomaticLineAdvanceDelay,
  getAutomaticLineMatchReason,
  getGoodLineCommandAcceptedText,
  hashLineText,
  inferSpeechRecognitionLanguage,
  isNextLineCommand,
  scoreLineMatch,
} from '../utils/lineMatching';
import { prepareRehearsalSpeech, speakRehearsalSpeech, stopRehearsalSpeech } from '../utils/rehearsalSpeech';
import { getRehearsalResponseTiming } from '../utils/rehearsalResponseTiming';
import { getNativePrototypeInfo } from '../utils/nativePrototype';
import { getWhisperSegmentationThreshold } from '../utils/whisperSpeechActivity';
import { getAutomaticRehearsalTargetIndex, getSceneAdvanceRecognitionAction, startRehearsalSceneAnnouncement } from '../utils/rehearsalSceneTransition';
import { filterScriptByScenes, isSceneMarker, isSongCue, lineMatchesRoles } from '../utils/scriptScenes';
import { findSharedSongForLine, formatSongAudioKind } from '../utils/sharedSongs';

interface Props {
  guion: Dialogue[];
  myRoles: string[];
  filterScenes: string[];
  sharedSongs?: SharedSongAsset[];
  musicalNumbers?: SharedMusicalNumberAsset[];
  scriptId?: string;
  scriptTitle?: string;
  shareId?: string | null;
  initialIndex?: number;
  spokenOnly?: boolean;
  onProgressChange?: (lineIndex: number, totalLines: number) => void;
  onExit: () => void;
}

type RehearsalPreflightPhase =
  | 'audio-check'
  | 'micro-calibration'
  | 'ready-to-calibrate'
  | 'ready-to-listen'
  | 'intelligent-check'
  | 'ready-to-start'
  | null;
type RehearsalListenModeSelection = 'pending' | 'auto' | 'manual' | 'intelligent';
type ConfirmedRehearsalListenMode = Exclude<RehearsalListenModeSelection, 'pending'>;
type RehearsalAudioModeSelection = 'pending' | SharedSongAudioKind;
type LineVariantMap = Record<string, string[]>;
type RehearsalAudioSelectionMap = Record<string, string>;
type RehearsalAudioSelectionTarget = 'song' | 'musical-number';
type LastIntelligentAutoAdvance = {
  fromIndex: number;
  toIndex: number;
  entry: IntelligentLineFeedbackEntry;
};

const DESKTOP_REHEARSAL_SPEECH_RATE = 1.14;
const MOBILE_REHEARSAL_SPEECH_RATE = 0.9;
const DESKTOP_MIN_TIMED_REHEARSAL_SPEECH_RATE = 0.92;
const MOBILE_MIN_TIMED_REHEARSAL_SPEECH_RATE = 0.78;
const DESKTOP_MAX_TIMED_REHEARSAL_SPEECH_RATE = 1.55;
const MOBILE_MAX_TIMED_REHEARSAL_SPEECH_RATE = 1.18;
const TIMELINE_CUE_SAFETY_MS = 260;
const APP_LINE_ADVANCE_DELAY_MS = 60;
const USER_LINE_RESPONSE_BUFFER_MS = 550;
const APP_SPEECH_WORDS_PER_SECOND = 2.65;
const USER_SPEECH_WORDS_PER_SECOND = 2.35;
const isSharedSongAudioKind = (value: unknown): value is SharedSongAudioKind =>
  value === 'karaoke' || value === 'vocal_guide';

const INTELLIGENT_FALSE_POSITIVE_ISSUES: {
  type: IntelligentLineFeedbackIssueType;
  label: string;
  hint: string;
}[] = [
  {
    type: 'corto_antes_de_tiempo',
    label: 'Corto antes',
    hint: 'La app avanzo cuando todavia estabas hablando.',
  },
  {
    type: 'dije_mal_mi_frase',
    label: 'La dije mal',
    hint: 'La frase reconocida no deberia entrenar la regla.',
  },
  {
    type: 'otro',
    label: 'Otro',
    hint: 'Anota cualquier pista util para revisar el caso.',
  },
];

const createSessionId = () => {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);

  return `intelligent-${Date.now().toString(36)}-${randomPart}`;
};

const getUserAgent = () =>
  typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
    ? navigator.userAgent
    : null;

const getSceneTitleForLine = (guion: Dialogue[], lineIndex: number) => {
  for (let index = Math.min(lineIndex, guion.length - 1); index >= 0; index -= 1) {
    if (isSceneMarker(guion[index])) {
      return guion[index].t;
    }
  }

  return null;
};

const buildLineVariantKey = (lineIndex: number, lineText: string) =>
  `${lineIndex}:${hashLineText(lineText)}`;

const countSpokenWords = (value: string) =>
  value
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

const countSentencePauses = (value: string) => (value.match(/[.!?;:]+/g) ?? []).length;

const estimateSpeechDurationMs = (
  value: string,
  wordsPerSecond: number,
  rate = 1
) => {
  const wordCount = countSpokenWords(value);
  if (wordCount === 0) {
    return 250;
  }

  const baseDurationMs =
    (wordCount / wordsPerSecond) * 1000 + countSentencePauses(value) * 160;
  return Math.max(700, baseDurationMs) / Math.max(rate, 0.1);
};

const clampSpeechRate = (value: number, minRate: number, maxRate: number) =>
  Math.max(minRate, Math.min(maxRate, value));

const isLikelyMobileSpeechDevice = () => {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
};

type WindowWithAudioContext = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

const getBrowserAudioContextConstructor = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const scopedWindow = window as WindowWithAudioContext;
  return scopedWindow.AudioContext ?? scopedWindow.webkitAudioContext ?? null;
};

const createWavObjectUrl = ({
  frequencyHz = 0,
  durationMs = 120,
  volume = 0,
}: {
  frequencyHz?: number;
  durationMs?: number;
  volume?: number;
}) => {
  if (typeof Blob === 'undefined' || typeof URL === 'undefined') {
    return null;
  }

  const sampleRate = 8000;
  const sampleCount = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);
  let offset = 0;

  const writeString = (value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index));
      offset += 1;
    }
  };

  writeString('RIFF');
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * bytesPerSample, true);
  offset += 4;
  view.setUint16(offset, bytesPerSample, true);
  offset += 2;
  view.setUint16(offset, 16, true);
  offset += 2;
  writeString('data');
  view.setUint32(offset, dataSize, true);
  offset += 4;

  for (let index = 0; index < sampleCount; index += 1) {
    const time = index / sampleRate;
    const sampleValue =
      frequencyHz > 0
        ? Math.sin(2 * Math.PI * frequencyHz * time) * Math.max(0, Math.min(volume, 1))
        : 0;
    view.setInt16(offset, Math.round(sampleValue * 32767), true);
    offset += 2;
  }

  return URL.createObjectURL(new Blob([wavBuffer], { type: 'audio/wav' }));
};

const createSilentWavObjectUrl = () => createWavObjectUrl({ durationMs: 120 });

const createMicroCalibrationToneObjectUrl = () =>
  createWavObjectUrl({ frequencyHz: 880, durationMs: 260, volume: 0.34 });

const buildRehearsalAudioSelectionKey = (
  target: RehearsalAudioSelectionTarget,
  targetId: string,
  audioKind: SharedSongAudioKind,
  roles: string[]
) => {
  const rolesKey =
    roles
      .map((role) => role.trim())
      .filter(Boolean)
      .sort((leftRole, rightRole) => leftRole.localeCompare(rightRole))
      .join('|') || 'sin-personaje';

  return `${target}:${targetId}:${audioKind}:${rolesKey}`;
};

const getAudioRoleStats = (audio: SharedSongAudioAsset, myRoles: string[]) => {
  const overlapCount = audio.guideRoles.filter((role) => myRoles.includes(role)).length;
  const outsideCount = audio.guideRoles.filter((role) => !myRoles.includes(role)).length;

  return {
    overlapCount,
    outsideCount,
    taggedCount: audio.guideRoles.length,
  };
};

const getRehearsalAudioChoiceCandidates = (
  audios: SharedSongAudioAsset[],
  preferredKind: SharedSongAudioKind,
  myRoles: string[]
) => {
  const sortedAudios = getPreferredRehearsalAudios(audios, preferredKind, myRoles);
  const firstAudio = sortedAudios[0];

  if (!firstAudio) {
    return [];
  }

  const firstStats = getAudioRoleStats(firstAudio, myRoles);
  return sortedAudios.filter((audio) => {
    const stats = getAudioRoleStats(audio, myRoles);

    return (
      audio.kind === firstAudio.kind &&
      stats.overlapCount === firstStats.overlapCount &&
      stats.outsideCount === firstStats.outsideCount &&
      stats.taggedCount === firstStats.taggedCount
    );
  });
};

const getPreferredRehearsalAudios = (
  audios: SharedSongAudioAsset[],
  preferredKind: SharedSongAudioKind,
  myRoles: string[],
  rememberedAudioId?: string | null
) => {
  if (!audios.length) {
    return [];
  }

  const karaokeAudios = audios.filter((audio) => audio.kind === 'karaoke');
  const vocalGuideAudios = audios.filter((audio) => audio.kind === 'vocal_guide');
  const participantRoles = Array.from(
    new Set(audios.flatMap((audio) => audio.guideRoles))
  );
  const allParticipantsCovered =
    participantRoles.length > 0 && participantRoles.every((role) => myRoles.includes(role));

  const rememberedAudio = rememberedAudioId
    ? audios.find((audio) => audio.id === rememberedAudioId) ?? null
    : null;

  const remainingAudios = rememberedAudio
    ? audios.filter((audio) => audio.id !== rememberedAudio.id)
    : audios;

  const sortByRoleStats = (
    audioList: SharedSongAudioAsset[],
    mode: 'matching-vocal' | 'complement-vocal' | 'broad-vocal' | 'karaoke'
  ) =>
    [...audioList].sort((leftAudio, rightAudio) => {
      const leftStats = getAudioRoleStats(leftAudio, myRoles);
      const rightStats = getAudioRoleStats(rightAudio, myRoles);

      if (mode === 'matching-vocal') {
        if (rightStats.overlapCount !== leftStats.overlapCount) {
          return rightStats.overlapCount - leftStats.overlapCount;
        }
      }

      if (mode === 'complement-vocal' || mode === 'broad-vocal') {
        if (rightStats.outsideCount !== leftStats.outsideCount) {
          return rightStats.outsideCount - leftStats.outsideCount;
        }
      }

      if (mode === 'broad-vocal') {
        if (leftStats.overlapCount !== rightStats.overlapCount) {
          return leftStats.overlapCount - rightStats.overlapCount;
        }
      }

      if (mode === 'karaoke') {
        if (rightStats.overlapCount !== leftStats.overlapCount) {
          return rightStats.overlapCount - leftStats.overlapCount;
        }
      }

      if (rightStats.taggedCount !== leftStats.taggedCount) {
        return rightStats.taggedCount - leftStats.taggedCount;
      }

      return leftAudio.label.localeCompare(rightAudio.label);
    });

  const matchingVocalGuides = sortByRoleStats(
    vocalGuideAudios.filter((audio) => getAudioRoleStats(audio, myRoles).overlapCount > 0),
    'matching-vocal'
  );
  const complementaryVocalGuides = sortByRoleStats(
    vocalGuideAudios.filter((audio) => {
      const stats = getAudioRoleStats(audio, myRoles);
      return stats.overlapCount === 0 && stats.outsideCount > 0;
    }),
    'complement-vocal'
  );
  const broadVocalGuides = sortByRoleStats(
    vocalGuideAudios.filter((audio) => getAudioRoleStats(audio, myRoles).outsideCount > 0),
    'broad-vocal'
  );
  const sortedKaraokes = sortByRoleStats(karaokeAudios, 'karaoke');

  const preferredAudios =
    preferredKind === 'karaoke'
      ? allParticipantsCovered && sortedKaraokes.length > 0
        ? [...sortedKaraokes, ...complementaryVocalGuides, ...broadVocalGuides]
        : complementaryVocalGuides.length > 0
          ? [...complementaryVocalGuides, ...sortedKaraokes, ...broadVocalGuides]
          : sortedKaraokes.length > 0
            ? [...sortedKaraokes, ...broadVocalGuides]
            : [...broadVocalGuides, ...matchingVocalGuides]
      : matchingVocalGuides.length > 0
        ? [...matchingVocalGuides, ...sortedKaraokes, ...broadVocalGuides]
        : sortedKaraokes.length > 0
          ? [...sortedKaraokes, ...broadVocalGuides]
          : [...broadVocalGuides];

  const seenAudioIds = new Set<string>();
  const sortedAudios = preferredAudios.filter((audio) => {
    if (seenAudioIds.has(audio.id)) {
      return false;
    }

    seenAudioIds.add(audio.id);
    return remainingAudios.some((candidate) => candidate.id === audio.id);
  });

  const trailingAudios = remainingAudios.filter((audio) => !seenAudioIds.has(audio.id));
  return rememberedAudio ? [rememberedAudio, ...sortedAudios, ...trailingAudios] : [...sortedAudios, ...trailingAudios];
};

export const RehearsalView: React.FC<Props> = ({
  guion,
  myRoles,
  filterScenes,
  sharedSongs = [],
  musicalNumbers = [],
  scriptId: providedScriptId,
  scriptTitle = 'Obra',
  shareId = null,
  initialIndex = 0,
  spokenOnly = false,
  onProgressChange,
  onExit,
}) => {
  const { palette, ui } = usePracticeTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const filteredGuion = useMemo(() => filterScriptByScenes(guion, filterScenes), [filterScenes, guion]);
  const isMobileSpeechDevice = useMemo(isLikelyMobileSpeechDevice, []);
  const defaultRehearsalSpeechRate = isMobileSpeechDevice
    ? MOBILE_REHEARSAL_SPEECH_RATE
    : DESKTOP_REHEARSAL_SPEECH_RATE;
  const minTimedRehearsalSpeechRate = isMobileSpeechDevice
    ? MOBILE_MIN_TIMED_REHEARSAL_SPEECH_RATE
    : DESKTOP_MIN_TIMED_REHEARSAL_SPEECH_RATE;
  const maxTimedRehearsalSpeechRate = isMobileSpeechDevice
    ? MOBILE_MAX_TIMED_REHEARSAL_SPEECH_RATE
    : DESKTOP_MAX_TIMED_REHEARSAL_SPEECH_RATE;
  const resolvedScriptId = useMemo(
    () =>
      providedScriptId ??
      hashLineText(
        JSON.stringify({
          lines: guion.length,
          firstLine: guion[0]?.t ?? '',
          lastLine: guion[guion.length - 1]?.t ?? '',
        })
      ),
    [guion, providedScriptId]
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [autoListenEnabled, setAutoListenEnabled] = useState(true);
  const [listenModeSelection, setListenModeSelection] =
    useState<RehearsalListenModeSelection>(() => resolveListenPreference(null, supportsRecognition()));
  const [rehearsalAudioModeSelection, setRehearsalAudioModeSelection] =
    useState<RehearsalAudioModeSelection>('karaoke');
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [recognitionEngine, setRecognitionEngine] = useState<RecognitionEngine>('native');
  const [showTranscript, setShowTranscript] = useState(true);
  const [showMicrophoneMenu, setShowMicrophoneMenu] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const pageVisible = usePageVisibility();
  const [isExitingRehearsal, setIsExitingRehearsal] = useState(false);
  const exitRequestedRef = useRef(false);
  const [sceneCommandReadyKey, setSceneCommandReadyKey] = useState<string | null>(null);
  const [sceneAnnouncementError, setSceneAnnouncementError] = useState<string | null>(null);
  const [preferenceNotice, setPreferenceNotice] = useState('');
  const [temporarilySuspendingAutoListen, setTemporarilySuspendingAutoListen] = useState(false);
  const [speechStatusMessage, setSpeechStatusMessage] = useState<string | null>(null);
  const [compatibilityMessage, setCompatibilityMessage] = useState<string | null>(null);
  const [isRehearsalMediaReady, setIsRehearsalMediaReady] = useState(false);
  const [isPreparingRehearsalMedia, setIsPreparingRehearsalMedia] = useState(false);
  const [rehearsalMediaStatus, setRehearsalMediaStatus] = useState<string | null>(null);
  const [hasPreparedRehearsalMedia, setHasPreparedRehearsalMedia] = useState(false);
  const [hasCompletedRehearsalPreflight, setHasCompletedRehearsalPreflight] = useState(false);
  const [rehearsalPreflightPhase, setRehearsalPreflightPhase] = useState<RehearsalPreflightPhase>(null);
  const [hasConfirmedRehearsalSetup, setHasConfirmedRehearsalSetup] = useState(false);
  const [speakerConfirmed, setSpeakerConfirmed] = useState(false);
  const [microphoneCalibrated, setMicrophoneCalibrated] = useState(false);
  const [hasSubmittedWhisperCheck, setHasSubmittedWhisperCheck] = useState(false);
  const preparationRunRef = useRef(0);
  useEffect(() => () => { preparationRunRef.current += 1; }, []);
  const [isSongPlaybackUnlocked, setIsSongPlaybackUnlocked] = useState(false);
  const [lineVariants, setLineVariants] = useState<LineVariantMap>({});
  const [selectedRehearsalAudioIds, setSelectedRehearsalAudioIds] =
    useState<RehearsalAudioSelectionMap>({});
  const [hasLoadedRehearsalAudioSelections, setHasLoadedRehearsalAudioSelections] =
    useState(false);
  const [intelligentFeedbackEntries, setIntelligentFeedbackEntries] = useState<
    IntelligentLineFeedbackEntry[]
  >([]);
  const [pendingInvalidAutoAdvance, setPendingInvalidAutoAdvance] =
    useState<IntelligentLineFeedbackEntry | null>(null);
  const [falsePositiveIssueType, setFalsePositiveIssueType] =
    useState<IntelligentLineFeedbackIssueType>('corto_antes_de_tiempo');
  const [falsePositiveIssueNote, setFalsePositiveIssueNote] = useState('');
  const [feedbackStatusMessage, setFeedbackStatusMessage] = useState<string | null>(null);
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);
  const sendingFeedbackRef = useRef(false);
  const [blockedAutoplayAudio, setBlockedAutoplayAudio] = useState<{
    audioId: string;
    audioUrl: string;
    playbackKind?: 'song' | 'musical-number';
    ownerId?: string | null;
    advanceOnEnd?: boolean;
    selectionKey?: string | null;
    timelineCues?: MusicalTimelineCue[];
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const calibrationAudioRef = useRef<HTMLAudioElement | null>(null);
  const songAudioContextRef = useRef<AudioContext | null>(null);
  const songAudioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const songAudioGainRef = useRef<GainNode | null>(null);
  const desiredSongAudioVolumeRef = useRef(1);
  const hasSongAudioGainFailedRef = useRef(false);
  const autoStartedSongKeyRef = useRef<string | null>(null);
  const autoStartedMusicalNumberKeyRef = useRef<string | null>(null);
  const selectedRehearsalAudioIdsRef = useRef<RehearsalAudioSelectionMap>({});
  const activeAudioPlaybackRef = useRef<{
    kind: 'song' | 'musical-number';
    ownerId: string | null;
    audioId: string | null;
    timelineCues: MusicalTimelineCue[];
    firedTimelineCueIds: Set<string>;
  } | null>(null);
  const intelligentSessionIdRef = useRef(createSessionId());
  const processedCommandLineKeyRef = useRef<string | null>(null);
  const processedGoodLineCommandKeyRef = useRef<string | null>(null);
  const processedAutoAdvanceLineKeyRef = useRef<string | null>(null);
  const lastIntelligentAutoAdvanceRef = useRef<LastIntelligentAutoAdvance | null>(null);
  const currentLine = filteredGuion[currentIndex];
  const currentLineIndexInScript = useMemo(
    () => (currentLine ? guion.indexOf(currentLine) : -1),
    [currentLine, guion]
  );
  const currentSceneTitle = useMemo(
    () =>
      currentLineIndexInScript >= 0
        ? getSceneTitleForLine(guion, currentLineIndexInScript)
        : null,
    [currentLineIndexInScript, guion]
  );
  const speakableLineText = useMemo(
    () =>
      currentLine?.t
        ?.replace(/\([^)]*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() ?? '',
    [currentLine]
  );
  const isMyTurn = lineMatchesRoles(currentLine, myRoles);
  const isFinished = currentIndex >= filteredGuion.length;
  const canGoBack = currentIndex > 0;
  const currentSongAsset = useMemo(
    () => findSharedSongForLine(sharedSongs, guion, currentLine),
    [currentLine, guion, sharedSongs]
  );
  const currentMusicalNumber = useMemo(
    () =>
      currentLineIndexInScript < 0
        ? null
        : musicalNumbers.find(
            (musicalNumber) =>
              currentLineIndexInScript >= musicalNumber.startLineIndex &&
              currentLineIndexInScript <= musicalNumber.endLineIndex
          ) ?? null,
    [currentLineIndexInScript, musicalNumbers]
  );
  const effectiveRehearsalAudioKind: SharedSongAudioKind =
    rehearsalAudioModeSelection === 'pending' ? 'karaoke' : rehearsalAudioModeSelection;
  const currentRehearsalAudioBaseAudios = useMemo(
    () =>
      currentMusicalNumber?.audios.length
        ? currentMusicalNumber.audios
        : currentSongAsset?.audios ?? [],
    [currentMusicalNumber, currentSongAsset]
  );
  const currentRehearsalAudioSelectionKey = useMemo(() => {
    if (currentMusicalNumber) {
      return buildRehearsalAudioSelectionKey(
        'musical-number',
        currentMusicalNumber.id,
        effectiveRehearsalAudioKind,
        myRoles
      );
    }

    if (currentSongAsset) {
      return buildRehearsalAudioSelectionKey(
        'song',
        currentSongAsset.id,
        effectiveRehearsalAudioKind,
        myRoles
      );
    }

    return null;
  }, [currentMusicalNumber, currentSongAsset, effectiveRehearsalAudioKind, myRoles]);
  const selectedCurrentRehearsalAudioId = useMemo(() => {
    const storedAudioId = currentRehearsalAudioSelectionKey
      ? selectedRehearsalAudioIds[currentRehearsalAudioSelectionKey]
      : null;

    return storedAudioId &&
      currentRehearsalAudioBaseAudios.some((audio) => audio.id === storedAudioId)
      ? storedAudioId
      : null;
  }, [
    currentRehearsalAudioBaseAudios,
    currentRehearsalAudioSelectionKey,
    selectedRehearsalAudioIds,
  ]);
  const currentRehearsalAudioChoiceCandidates = useMemo(
    () =>
      getRehearsalAudioChoiceCandidates(
        currentRehearsalAudioBaseAudios,
        effectiveRehearsalAudioKind,
        myRoles
      ),
    [currentRehearsalAudioBaseAudios, effectiveRehearsalAudioKind, myRoles]
  );
  const shouldAskForRehearsalAudioChoice =
    hasLoadedRehearsalAudioSelections &&
    currentRehearsalAudioChoiceCandidates.length > 1 &&
    !selectedCurrentRehearsalAudioId;
  const preferredMusicalNumberAudio = useMemo<SharedSongAudioAsset | null>(() => {
    if (!currentMusicalNumber?.audios.length) {
      return null;
    }

    return (
      getPreferredRehearsalAudios(
        currentMusicalNumber.audios,
        effectiveRehearsalAudioKind,
        myRoles,
        selectedCurrentRehearsalAudioId
      )[0] ?? null
    );
  }, [currentMusicalNumber, effectiveRehearsalAudioKind, myRoles, selectedCurrentRehearsalAudioId]);
  const preferredSongAudio = useMemo<SharedSongAudioAsset | null>(() => {
    if (currentMusicalNumber || !currentSongAsset?.audios.length) {
      return null;
    }

    return (
      getPreferredRehearsalAudios(
        currentSongAsset.audios,
        effectiveRehearsalAudioKind,
        myRoles,
        selectedCurrentRehearsalAudioId
      )[0] ?? null
    );
  }, [
    currentMusicalNumber,
    currentSongAsset,
    effectiveRehearsalAudioKind,
    myRoles,
    selectedCurrentRehearsalAudioId,
  ]);
  const currentRehearsalAudioOptions = useMemo(
    () =>
      getPreferredRehearsalAudios(
        currentRehearsalAudioBaseAudios,
        effectiveRehearsalAudioKind,
        myRoles,
        selectedCurrentRehearsalAudioId
      ),
    [
      currentRehearsalAudioBaseAudios,
      effectiveRehearsalAudioKind,
      myRoles,
      selectedCurrentRehearsalAudioId,
    ]
  );
  const canStartRehearsalAudio =
    !isPaused &&
    !isSceneMarker(currentLine) &&
    hasConfirmedRehearsalSetup &&
    isRehearsalMediaReady &&
    hasCompletedRehearsalPreflight &&
    !rehearsalPreflightPhase &&
    listenModeSelection !== 'pending' &&
    rehearsalAudioModeSelection !== 'pending';
  const isCurrentLineSongCue = isSongCue(currentLine);
  const currentMusicalBlockKind = useMemo<MusicalTimelineCueTargetKind | null>(() => {
    const activePlayback = activeAudioPlaybackRef.current;

    if (
      !playingAudioId ||
      !currentMusicalNumber ||
      activePlayback?.kind !== 'musical-number' ||
      activePlayback.ownerId !== currentMusicalNumber.id ||
      currentLineIndexInScript < currentMusicalNumber.startLineIndex ||
      currentLineIndexInScript > currentMusicalNumber.endLineIndex
    ) {
      return null;
    }

    if (isCurrentLineSongCue) {
      return 'song';
    }

    const firstMusicalLine = guion[currentMusicalNumber.startLineIndex];
    let activeKind: MusicalTimelineCueTargetKind = isSongCue(firstMusicalLine)
      ? 'song'
      : 'dialogue';
    let activeBoundaryLineIndex = currentMusicalNumber.startLineIndex;

    activePlayback.timelineCues.forEach((cue) => {
      const cueIsInsideCurrentNumber =
        cue.targetLineIndex >= currentMusicalNumber.startLineIndex &&
        cue.targetLineIndex <= currentMusicalNumber.endLineIndex;

      if (
        !cueIsInsideCurrentNumber ||
        cue.targetLineIndex > currentLineIndexInScript ||
        cue.targetLineIndex < activeBoundaryLineIndex
      ) {
        return;
      }

      activeKind = cue.targetKind;
      activeBoundaryLineIndex = cue.targetLineIndex;
    });

    return activeKind;
  }, [
    currentLineIndexInScript,
    currentMusicalNumber,
    guion,
    isCurrentLineSongCue,
    playingAudioId,
  ]);
  const isCurrentMusicalSongBlock = isCurrentLineSongCue || currentMusicalBlockKind === 'song';
  const currentSongKey = isCurrentLineSongCue
    ? `${currentIndex}:${currentSongAsset?.id ?? currentLine?.songTitle ?? 'song'}`
    : null;
  const currentMusicalNumberKey = currentMusicalNumber
    ? `${currentMusicalNumber.id}:${currentMusicalNumber.updatedAt}`
    : null;
  const currentDialogueKey =
    !isFinished && currentLine ? `${currentIndex}:${currentLine.p}:${currentLine.t}` : null;
  const currentSceneTransitionKey = isSceneMarker(currentLine) ? currentDialogueKey : null;
  const currentLineVariantKey =
    !isFinished && currentLine && currentLineIndexInScript >= 0
      ? buildLineVariantKey(currentLineIndexInScript, currentLine.t)
      : null;
  const currentAcceptedLineVariants = useMemo(
    () => (currentLineVariantKey ? lineVariants[currentLineVariantKey] ?? [] : []),
    [currentLineVariantKey, lineVariants]
  );
  const intelligentRecognitionLanguage = useMemo(() => {
    if (isSceneMarker(filteredGuion[currentIndex])) return 'es-ES';
    const nextActorLine = filteredGuion.slice(currentIndex).find((line) =>
      !isSceneMarker(line) && !isSongCue(line) && lineMatchesRoles(line, myRoles)
    );
    return inferSpeechRecognitionLanguage(isMyTurn ? speakableLineText : nextActorLine?.t ?? speakableLineText);
  }, [currentIndex, filteredGuion, isMyTurn, myRoles, speakableLineText]);
  const isIntelligentListenMode = listenModeSelection === 'intelligent';
  const recognitionContext = useMemo(() => buildScriptRecognitionContext(filteredGuion), [filteredGuion]);
  const isCheckingIntelligentRecognition = isIntelligentListenMode && rehearsalPreflightPhase === 'intelligent-check';
  const recognitionPreparationKey = `prepare:${resolvedScriptId}`;
  const effectiveAutoListenEnabled = autoListenEnabled && !temporarilySuspendingAutoListen;
  const canRunRehearsalLinePlayback =
    pageVisible &&
    !isPaused &&
    hasConfirmedRehearsalSetup &&
    isRehearsalMediaReady &&
    hasCompletedRehearsalPreflight &&
    !rehearsalPreflightPhase;
  const shouldArmListeningForCurrentLine =
    canRunRehearsalLinePlayback &&
    effectiveAutoListenEnabled &&
    !isIntelligentListenMode &&
    !isFinished &&
    Boolean(currentLine) &&
    !isSceneMarker(currentLine) &&
    !isCurrentMusicalSongBlock &&
    isMyTurn &&
    speakableLineText.length > 0;
  const shouldListenToActor =
    canRunRehearsalLinePlayback &&
    isIntelligentListenMode &&
    !isFinished &&
    Boolean(currentLine) &&
    !isSceneMarker(currentLine) &&
    !isCurrentMusicalSongBlock &&
    isMyTurn &&
    speakableLineText.length > 0;
  const shouldUseRehearsalComparison = shouldListenToActor && recognitionEngine === 'comparison';
  const shouldUseIntelligentRecognition = shouldListenToActor && recognitionEngine !== 'comparison';
  const canReportCurrentLine = isIntelligentListenMode && hasCompletedRehearsalPreflight && !isFinished &&
    Boolean(currentLine) && !isSceneMarker(currentLine) && !isCurrentMusicalSongBlock && isMyTurn && speakableLineText.length > 0;
  const shouldListenForSceneCommand =
    canRunRehearsalLinePlayback &&
    currentSceneTransitionKey !== null &&
    sceneCommandReadyKey === currentSceneTransitionKey &&
    (listenModeSelection === 'intelligent' || listenModeSelection === 'auto');
  const shouldKeepIntelligentRecognitionWarm =
    isCheckingIntelligentRecognition ||
    shouldUseIntelligentRecognition ||
    shouldListenForSceneCommand;
  const shouldSuspendListeningDuringSong =
    canRunRehearsalLinePlayback &&
    effectiveAutoListenEnabled &&
    Boolean(currentLine) &&
    isCurrentMusicalSongBlock;
  const recognitionLineKey =
    isCheckingIntelligentRecognition ? recognitionPreparationKey :
      currentLineVariantKey ?? (shouldKeepIntelligentRecognitionWarm ? `warm:${currentIndex}` : null);

  const isAutoplayBlockedError = useCallback((error: unknown) => {
    const errorName =
      error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
    const errorMessage =
      error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
    const normalizedText = `${errorName} ${errorMessage}`.toLowerCase();

    return (
      normalizedText.includes('notallowed') ||
      normalizedText.includes('not allowed') ||
      normalizedText.includes('user gesture') ||
      normalizedText.includes('gesture')
    );
  }, []);

  const advanceLine = useCallback(() => {
    if (!isPageVisible()) return;
    setCurrentIndex((previousIndex) =>
      getAutomaticRehearsalTargetIndex(filteredGuion, previousIndex)
    );
  }, [filteredGuion]);

  const {
    listeningStatus,
    listeningError,
    isListeningActive,
    signalLevel,
    rawLevel,
    hasSpeechStarted,
    isSignalAboveThreshold,
    silenceElapsedMs,
    voiceThreshold,
    microphoneNoiseFloor,
    microphoneVoiceLevel,
    microphoneCalibrationProgress,
    lineStateLabel,
    calibrateAmbientNoise,
    calibrateVoiceLevel,
    resetMicrophoneCalibration,
    applyMicrophoneCalibration,
    startListening,
    stopListening,
    releaseListeningInput,
    releaseListening,
  } = useSilenceAdvance({
    enabledForCurrentLine: shouldArmListeningForCurrentLine,
    lineKey: currentDialogueKey,
    onSilenceDetected: advanceLine,
  });

  const {
    isSupported: isSpeechRecognitionSupported,
    isLocal: isLocalSpeechRecognition,
    status: speechRecognitionStatus,
    transcript: speechRecognitionTranscript,
    finalTranscript: speechRecognitionFinalTranscript,
    interimTranscript: speechRecognitionInterimTranscript,
    isAudioActive: isRecognitionAudioActive,
    hasReceivedTranscript: hasRecognitionReceivedText,
    getRecognitionProcessingTiming,
    error: speechRecognitionError,
    errorCode: speechRecognitionErrorCode,
    errorDetail: speechRecognitionErrorDetail,
    resetTranscript: resetSpeechRecognitionTranscript,
    finishRecognitionInput,
    activateRecognition,
    restartRecognition,
    stopRecognition: stopOrdinaryRecognition,
    waitForRecognitionEnd: waitForOrdinaryRecognitionEnd,
    waitForRecognitionInputEnd: waitForOrdinaryRecognitionInputEnd,
    getRecognitionInputEndReason,
    notifyRecognitionPlaybackEnd: notifyOrdinaryRecognitionPlaybackEnd,
  } = useSpeechRecognition({
    enabled: shouldKeepIntelligentRecognitionWarm,
    lang: recognitionEngine === 'vosk' || isCheckingIntelligentRecognition ? 'es-ES' : intelligentRecognitionLanguage,
    lineKey: recognitionLineKey,
    prepareLocal: hasConfirmedRehearsalSetup && isIntelligentListenMode,
    engine: recognitionEngine,
    context: shouldUseIntelligentRecognition ? recognitionContext : undefined,
    whisperLanguage: shouldListenForSceneCommand ? 'spanish' : 'auto',
    whisperMicrophoneCheck: isCheckingIntelligentRecognition,
    whisperSpeechThreshold: getWhisperSegmentationThreshold(microphoneNoiseFloor, microphoneVoiceLevel),
  });

  const comparisonHandlerRef = useRef<(result: RehearsalComparisonResult) => void>(() => {});
  const comparisonLineMetadataRef = useRef(new Map<string, ComparisonLineMetadata>());
  const feedbackEntriesRef = useRef(intelligentFeedbackEntries); feedbackEntriesRef.current = intelligentFeedbackEntries;
  const comparisonDraftKey = `@teatro_ia_comparison_draft:${resolvedScriptId}`;
  const persistComparisonDraft = useCallback(async (entries: IntelligentLineFeedbackEntry[]) => {
    const comparisons = entries.filter(entry => entry.rehearsalComparison);
    await AsyncStorage.setItem(comparisonDraftKey, JSON.stringify(comparisons));
  }, [comparisonDraftKey]);
  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(comparisonDraftKey).then(stored => {
      if (!stored || cancelled) return;
      const parsed: unknown = JSON.parse(stored);
      if (!Array.isArray(parsed)) return;
      const entries = parsed.filter((entry): entry is IntelligentLineFeedbackEntry => Boolean(entry?.rehearsalComparison?.id && typeof entry.expectedText === 'string'));
      setIntelligentFeedbackEntries(current => {
        const ids = new Set(current.map(entry => entry.rehearsalComparison?.id));
        const next = [...entries.filter(entry => !ids.has(entry.rehearsalComparison?.id)), ...current]; feedbackEntriesRef.current = next; return next;
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [comparisonDraftKey]);
  if (shouldUseRehearsalComparison && currentLineVariantKey && currentLine) comparisonLineMetadataRef.current.set(currentLineVariantKey, {
    lineIndex: currentLineIndexInScript, character: currentLine.p, sceneTitle: currentSceneTitle,
    expectedText: currentLine.t, speakableText: speakableLineText, language: intelligentRecognitionLanguage,
  });
  const comparison = useRehearsalComparison({ selected: recognitionEngine === 'comparison', enabled: shouldUseRehearsalComparison,
    pageVisible, lineKey: currentLineVariantKey, lang: intelligentRecognitionLanguage, context: recognitionContext,
    speechThreshold: getWhisperSegmentationThreshold(microphoneNoiseFloor, microphoneVoiceLevel),
    onResult: result => comparisonHandlerRef.current(result),
  });
  const { stop: stopComparison, finish: finishComparison, waitForEnd: waitForComparisonEnd,
    notifyPlaybackEnd: notifyComparisonPlaybackEnd, snapshotForReport: snapshotComparisonForReport } = comparison;
  const stopRecognition = useCallback(() => { stopOrdinaryRecognition(); stopComparison(); }, [stopOrdinaryRecognition, stopComparison]);
  const waitForRecognitionEnd = useCallback(async () => (await Promise.all([waitForOrdinaryRecognitionEnd(), waitForComparisonEnd()])).every(Boolean), [waitForOrdinaryRecognitionEnd, waitForComparisonEnd]);
  const waitForRecognitionInputEnd = useCallback(async () => (await Promise.all([waitForOrdinaryRecognitionInputEnd(), waitForComparisonEnd()])).every(Boolean), [waitForOrdinaryRecognitionInputEnd, waitForComparisonEnd]);
  const notifyRecognitionPlaybackEnd = useCallback(() => { notifyOrdinaryRecognitionPlaybackEnd(); notifyComparisonPlaybackEnd(); }, [notifyOrdinaryRecognitionPlaybackEnd, notifyComparisonPlaybackEnd]);
  comparisonHandlerRef.current = result => {
    const key = result.turn.key.slice(0, result.turn.key.lastIndexOf(':'));
    const metadata = comparisonLineMetadataRef.current.get(key);
    if (!metadata || feedbackEntriesRef.current.some(entry => entry.rehearsalComparison?.id === result.turn.id)) return;
    const entry = makeRehearsalComparisonEntry(result, metadata);
    const next = [...feedbackEntriesRef.current, entry]; feedbackEntriesRef.current = next; setIntelligentFeedbackEntries(next);
    void persistComparisonDraft(next).catch(() => setFeedbackStatusMessage('El resultado está en el informe, pero no se pudo recordar al salir.'));
    if ((result.completion === 'speech_end' || result.completion === 'button') && shouldUseRehearsalComparison && currentLineVariantKey === key && isPageVisible()) advanceLine();
  };

  const startCurrentScene = useCallback(() => {
    if (!isPageVisible()) return;
    stopRehearsalSpeech();
    resetSpeechRecognitionTranscript();
    setSceneCommandReadyKey(null);
    setCurrentIndex((previousIndex) =>
      previousIndex === currentIndex && isSceneMarker(filteredGuion[previousIndex])
        ? previousIndex + 1
        : previousIndex
    );
  }, [currentIndex, filteredGuion, resetSpeechRecognitionTranscript]);

  useEffect(() => {
    if (!shouldListenForSceneCommand) return;
    const action = getSceneAdvanceRecognitionAction({
      finalTranscript: speechRecognitionFinalTranscript,
      interimTranscript: speechRecognitionInterimTranscript,
      acceptInterim: usesWhisperRecognition(recognitionEngine),
    });
    if (action === 'start') {
      startCurrentScene();
    } else if (action === 'discard') {
      // Discard conversation while waiting, so a later "adelante" stands alone.
      resetSpeechRecognitionTranscript();
    }
  }, [recognitionEngine, resetSpeechRecognitionTranscript, shouldListenForSceneCommand, speechRecognitionFinalTranscript,
    speechRecognitionInterimTranscript, startCurrentScene]);

  const intelligentLineMatch = useMemo(
    () =>
      scoreLineMatch(
        speakableLineText,
        speechRecognitionTranscript,
        currentAcceptedLineVariants
      ),
    [currentAcceptedLineVariants, speakableLineText, speechRecognitionTranscript]
  );

  const persistLineVariants = useCallback(
    async (nextVariants: LineVariantMap) => {
      try {
        await AsyncStorage.setItem(
          `${INTELLIGENT_LINE_VARIANTS_STORAGE_PREFIX}${resolvedScriptId}`,
          JSON.stringify(nextVariants)
        );
      } catch (error) {
        console.error('Error guardando variantes de lineas', error);
      }
    },
    [resolvedScriptId]
  );

  const handleSelectListenMode = useCallback((nextMode: ConfirmedRehearsalListenMode) => {
    if (nextMode === 'intelligent' && !isSpeechRecognitionSupported) {
      return;
    }

    setListenModeSelection(nextMode);
    void AsyncStorage.setItem(REHEARSAL_LISTEN_MODE_STORAGE_KEY, nextMode).catch((error) => {
      console.error('Error guardando modo de ensayo', error);
    });
  }, [isSpeechRecognitionSupported]);

  const handleSelectRehearsalAudioMode = useCallback((nextMode: SharedSongAudioKind) => {
    setRehearsalAudioModeSelection(nextMode);
    void AsyncStorage.setItem(REHEARSAL_AUDIO_MODE_STORAGE_KEY, nextMode).catch((error) => {
      console.error('Error guardando modo musical de ensayo', error);
    });
  }, []);

  const rememberRehearsalAudioSelection = useCallback(
    (selectionKey: string | null | undefined, audioId: string) => {
      if (!selectionKey) {
        return;
      }

      const nextSelections = {
        ...selectedRehearsalAudioIdsRef.current,
        [selectionKey]: audioId,
      };

      selectedRehearsalAudioIdsRef.current = nextSelections;
      setSelectedRehearsalAudioIds(nextSelections);
      void AsyncStorage.setItem(
        `${REHEARSAL_AUDIO_SELECTION_STORAGE_PREFIX}${resolvedScriptId}`,
        JSON.stringify(nextSelections)
      ).catch((error) => {
        console.error('Error guardando seleccion de audio de ensayo', error);
      });
    },
    [resolvedScriptId]
  );

  const recordIntelligentFeedback = useCallback(
    (result: IntelligentLineFeedbackResult, heardTextOverride?: string) => {
      if (recognitionEngine === 'comparison') { finishComparison('manual'); return null; }
      if (!currentLine || currentLineIndexInScript < 0) {
        return null;
      }

      const heardText = heardTextOverride ?? speechRecognitionTranscript.trim();
      const feedbackLineMatch =
        heardTextOverride === undefined
          ? intelligentLineMatch
          : scoreLineMatch(speakableLineText, heardText, currentAcceptedLineVariants);
      const score = Number(feedbackLineMatch.score.toFixed(3));
      const autoAdvanceReason = getAutomaticLineMatchReason(
        speakableLineText,
        heardText,
        feedbackLineMatch
      );
      const entry: IntelligentLineFeedbackEntry = {
        recognitionEngine: usesWhisperRecognition(recognitionEngine) ? 'whisper' : isLocalSpeechRecognition ? 'vosk' : 'native',
        scriptContextEnabled: usesWhisperRecognition(recognitionEngine) && Boolean(recognitionContext.prompt),
        scriptContextTermCount: usesWhisperRecognition(recognitionEngine) ? recognitionContext.names.length + recognitionContext.vocabulary.length : 0,
        recognitionTiming: usesWhisperRecognition(recognitionEngine) ? getRecognitionProcessingTiming() : null,
        lineIndex: currentLineIndexInScript,
        character: currentLine.p,
        sceneTitle: currentSceneTitle,
        expectedText: currentLine.t,
        heardText,
        score,
        coverageScore: Number(feedbackLineMatch.coverageScore.toFixed(3)),
        orderScore: Number(feedbackLineMatch.orderScore.toFixed(3)),
        finalScore: Number(feedbackLineMatch.finalScore.toFixed(3)),
        finalPhraseScore: Number(feedbackLineMatch.finalPhraseScore.toFixed(3)),
        finalPhraseWordCount: feedbackLineMatch.finalPhraseWordCount,
        precisionScore: Number(feedbackLineMatch.precisionScore.toFixed(3)),
        negationPenaltyApplied: feedbackLineMatch.negationPenaltyApplied,
        autoAdvanceReason,
        result,
        ...(result === 'informe_parcial' && speechRecognitionError ? { issueType: 'otro' as const, issueNote: speechRecognitionError } : {}),
        matchedReferenceText: feedbackLineMatch.referenceText,
        matchedReferenceIndex: feedbackLineMatch.referenceIndex,
        language: intelligentRecognitionLanguage,
        createdAt: new Date().toISOString(),
      };

      setIntelligentFeedbackEntries((previousEntries) => [...previousEntries, entry]);
      setFeedbackStatusMessage(`Resultado guardado: ${result.replace(/_/g, ' ')}.`);
      return entry;
    },
    [
      currentLine,
      currentLineIndexInScript,
      currentSceneTitle,
      currentAcceptedLineVariants,
      intelligentLineMatch,
      intelligentRecognitionLanguage,
      speakableLineText,
      speechRecognitionTranscript,
      speechRecognitionError,
      recognitionEngine,
      recognitionContext,
      getRecognitionProcessingTiming,
      isLocalSpeechRecognition,
      finishComparison,
    ]
  );

  const saveCurrentTranscriptAsVariant = useCallback(async (heardTextOverride?: string) => {
    const heardText = heardTextOverride ?? speechRecognitionTranscript.trim();

    if (!currentLineVariantKey || !heardText) {
      return;
    }

    const nextVariants = {
      ...lineVariants,
      [currentLineVariantKey]: Array.from(
        new Set([...(lineVariants[currentLineVariantKey] ?? []), heardText])
      ).slice(-8),
    };

    setLineVariants(nextVariants);
    await persistLineVariants(nextVariants);
  }, [currentLineVariantKey, lineVariants, persistLineVariants, speechRecognitionTranscript]);

  const handleAcceptIntelligentLine = useCallback(async (heardTextOverride?: string) => {
    recordIntelligentFeedback('linea_buena', heardTextOverride);
    await saveCurrentTranscriptAsVariant(heardTextOverride);
    resetSpeechRecognitionTranscript();
    advanceLine();
  }, [
    advanceLine,
    recordIntelligentFeedback,
    resetSpeechRecognitionTranscript,
    saveCurrentTranscriptAsVariant,
  ]);

  const handleRetryIntelligentLine = useCallback(() => {
    stopRehearsalSpeech();
    if (speechRecognitionTranscript.trim()) {
      recordIntelligentFeedback('reintentar');
      setFeedbackStatusMessage('Resultado guardado. Reintentamos esta linea.');
    } else {
      setFeedbackStatusMessage('Reiniciando la escucha de esta linea.');
    }

    restartRecognition();
  }, [recordIntelligentFeedback, restartRecognition, speechRecognitionTranscript]);

  const handleSkipIntelligentLine = useCallback(() => {
    recordIntelligentFeedback('siguiente_linea');
    resetSpeechRecognitionTranscript();
    advanceLine();
  }, [advanceLine, recordIntelligentFeedback, resetSpeechRecognitionTranscript]);

  const handleRejectLastAutoAdvance = useCallback(() => {
    if (!pendingInvalidAutoAdvance) {
      return;
    }

    const falsePositiveEntry: IntelligentLineFeedbackEntry = {
      ...pendingInvalidAutoAdvance,
      result: 'falso_positivo',
      issueType: falsePositiveIssueType,
      issueNote: falsePositiveIssueNote.trim() || null,
      createdAt: new Date().toISOString(),
    };

    setIntelligentFeedbackEntries((previousEntries) => [...previousEntries, falsePositiveEntry]);
    setFeedbackStatusMessage('Autoavance marcado como incorrecto. Lo incluiremos en el informe.');
    setPendingInvalidAutoAdvance(null);
    setFalsePositiveIssueType('corto_antes_de_tiempo');
    setFalsePositiveIssueNote('');
    restartRecognition();
  }, [
    falsePositiveIssueNote,
    falsePositiveIssueType,
    pendingInvalidAutoAdvance,
    restartRecognition,
  ]);

  const handleSendIntelligentFeedback = useCallback(async () => {
    if (sendingFeedbackRef.current) {
      return;
    }

    sendingFeedbackRef.current = true;
    setIsSendingFeedback(true);
    setFeedbackStatusMessage('Enviando informe de prueba...');

    try {
      let currentEntry: IntelligentLineFeedbackEntry | null = null;
      if (canReportCurrentLine) {
        if (recognitionEngine === 'comparison') {
          const snapshot = snapshotComparisonForReport();
          const metadata = currentLineVariantKey ? comparisonLineMetadataRef.current.get(currentLineVariantKey) : null;
          const snapshotLineKey = snapshot?.turn.key.slice(0, snapshot.turn.key.lastIndexOf(':'));
          if (snapshot && metadata && snapshotLineKey === currentLineVariantKey) {
            currentEntry = makeRehearsalComparisonEntry(snapshot, metadata);
            const entry = currentEntry;
            setIntelligentFeedbackEntries(entries => [...entries, entry]);
          }
        } else if (!feedbackEntriesRef.current.some(entry => entry.result === 'informe_parcial' &&
          entry.lineIndex === currentLineIndexInScript && entry.expectedText === currentLine?.t &&
          entry.recognitionEngine === recognitionEngine && entry.heardText === speechRecognitionTranscript.trim())) {
          currentEntry = recordIntelligentFeedback('informe_parcial');
        }
      }
      const entriesToSend = feedbackEntriesRef.current.slice();
      if (currentEntry && !entriesToSend.includes(currentEntry)) entriesToSend.push(currentEntry);
      if (!entriesToSend.length) { setFeedbackStatusMessage('Todavía no hay réplicas guardadas.'); return; }
      setFeedbackStatusMessage('Enviando informe de prueba...');
      void persistComparisonDraft(entriesToSend).catch(() => {});
      const result = await submitIntelligentLineFeedback({
        sessionId: intelligentSessionIdRef.current,
        scriptId: resolvedScriptId,
        shareId,
        scriptTitle,
        appVersion: packageInfo.version,
        runtime: getNativePrototypeInfo()?.platform === 'ios' ? 'native_ios' : getNativePrototypeInfo()?.platform === 'android' ? 'native_android' : 'browser',
        nativeAppVersion: getNativePrototypeInfo()?.appVersion,
        userRoles: myRoles,
        userAgent: getUserAgent(),
        entries: entriesToSend,
      });

      // Each acknowledged batch gets its own blob; a later partial report must
      // never overwrite the earlier scenes sent from this rehearsal.
      intelligentSessionIdRef.current = createSessionId();
      const sent = new Set(entriesToSend);
      setIntelligentFeedbackEntries(current => {
        const remaining = current.filter(entry => !sent.has(entry)); feedbackEntriesRef.current = remaining;
        void persistComparisonDraft(remaining).catch(() => {}); return remaining;
      });
      setFeedbackStatusMessage(`Informe enviado (${result.entryCount} lineas).`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo enviar el informe de prueba.';
      setFeedbackStatusMessage(message);
    } finally {
      sendingFeedbackRef.current = false;
      setIsSendingFeedback(false);
    }
  }, [
    myRoles,
    resolvedScriptId,
    scriptTitle,
    shareId,
    persistComparisonDraft,
    recognitionEngine,
    canReportCurrentLine,
    snapshotComparisonForReport,
    currentLineVariantKey,
    currentLineIndexInScript,
    currentLine,
    speechRecognitionTranscript,
    recordIntelligentFeedback,
  ]);

  useEffect(() => {
    if (
      !shouldUseIntelligentRecognition ||
      !currentLineVariantKey ||
      !speechRecognitionTranscript.trim()
    ) {
      return;
    }

    const acceptedText = getGoodLineCommandAcceptedText(speechRecognitionTranscript);

    if (acceptedText === null) {
      return;
    }

    const commandKey = `${currentLineVariantKey}:${speechRecognitionTranscript}:linea_buena`;
    if (processedGoodLineCommandKeyRef.current === commandKey) {
      return;
    }

    processedGoodLineCommandKeyRef.current = commandKey;
    void handleAcceptIntelligentLine(acceptedText);
  }, [
    currentLineVariantKey,
    handleAcceptIntelligentLine,
    shouldUseIntelligentRecognition,
    speechRecognitionTranscript,
  ]);

  useEffect(() => {
    if (
      !shouldUseIntelligentRecognition ||
      !currentLineVariantKey ||
      !speechRecognitionTranscript.trim() ||
      !isNextLineCommand(speechRecognitionTranscript)
    ) {
      return;
    }

    const commandKey = `${currentLineVariantKey}:${speechRecognitionTranscript}`;
    if (processedCommandLineKeyRef.current === commandKey) {
      return;
    }

    processedCommandLineKeyRef.current = commandKey;
    recordIntelligentFeedback('comando_siguiente');
    resetSpeechRecognitionTranscript();
    advanceLine();
  }, [
    advanceLine,
    currentLineVariantKey,
    recordIntelligentFeedback,
    resetSpeechRecognitionTranscript,
    shouldUseIntelligentRecognition,
    speechRecognitionTranscript,
  ]);

  useEffect(() => {
    const automaticReason = getAutomaticLineMatchReason(
      speakableLineText,
      speechRecognitionTranscript,
      intelligentLineMatch
    );
    const advanceDelay = getAutomaticLineAdvanceDelay(
      speakableLineText, speechRecognitionTranscript,
      speechRecognitionInterimTranscript, intelligentLineMatch
    );

    if (
      !shouldUseIntelligentRecognition ||
      !currentLineVariantKey ||
      !currentLine ||
      currentLineIndexInScript < 0 ||
      advanceDelay === null ||
      !speechRecognitionTranscript.trim() ||
      !automaticReason
    ) {
      return;
    }

    const autoAdvanceKey = `${currentLineVariantKey}:${speechRecognitionTranscript}:${intelligentLineMatch.referenceIndex}:${automaticReason}`;
    if (processedAutoAdvanceLineKeyRef.current === autoAdvanceKey) {
      return;
    }

    const autoAdvanceTimeout = setTimeout(() => {
      if (!isPageVisible()) return;
      if (processedAutoAdvanceLineKeyRef.current === autoAdvanceKey) {
        return;
      }

      processedAutoAdvanceLineKeyRef.current = autoAdvanceKey;
      const entry = recordIntelligentFeedback('auto_avance');
      if (entry) {
        lastIntelligentAutoAdvanceRef.current = {
          fromIndex: currentIndex,
          toIndex: Math.min(currentIndex + 1, filteredGuion.length),
          entry,
        };
      }
      resetSpeechRecognitionTranscript();
      advanceLine();
    }, advanceDelay);

    return () => {
      clearTimeout(autoAdvanceTimeout);
    };
  }, [
    advanceLine,
    currentIndex,
    currentLine,
    currentLineIndexInScript,
    currentLineVariantKey,
    filteredGuion.length,
    intelligentLineMatch,
    recordIntelligentFeedback,
    resetSpeechRecognitionTranscript,
    shouldUseIntelligentRecognition,
    speakableLineText,
    speechRecognitionInterimTranscript,
    speechRecognitionTranscript,
  ]);

  useEffect(() => {
    if (currentLineVariantKey) {
      processedCommandLineKeyRef.current = null;
      processedGoodLineCommandKeyRef.current = null;
      processedAutoAdvanceLineKeyRef.current = null;
      setFeedbackStatusMessage(null);
    }
  }, [currentLineVariantKey]);

  useEffect(() => {
    if (
      pendingInvalidAutoAdvance &&
      pendingInvalidAutoAdvance.lineIndex !== currentLineIndexInScript
    ) {
      setPendingInvalidAutoAdvance(null);
      setFalsePositiveIssueType('corto_antes_de_tiempo');
      setFalsePositiveIssueNote('');
    }
  }, [currentLineIndexInScript, pendingInvalidAutoAdvance]);

  const disableAutoListenForDevice = useCallback(
    async (reasonMessage: string, storedValue = 'manual-disabled') => {
      setAutoListenEnabled(false);
      setListenModeSelection('manual');
      setTemporarilySuspendingAutoListen(false);
      setIsRehearsalMediaReady(true);
      setIsPreparingRehearsalMedia(false);
      setHasPreparedRehearsalMedia(false);
      setHasCompletedRehearsalPreflight(true);
      setRehearsalPreflightPhase(null);
      setRehearsalMediaStatus(null);
      setCompatibilityMessage(reasonMessage);
      await releaseListening();

      try {
        await AsyncStorage.setItem(REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY, storedValue);
      } catch (error) {
        console.error('Error guardando compatibilidad de audio', error);
      }
    },
    [releaseListening]
  );

  const finishRehearsalPreparation = useCallback((recognizedText?: string) => {
    const preparation = rehearsalPreparationSession.getSnapshot();
    const engineKey = usesWhisperRecognition(recognitionEngine) ? 'whisper' : isLocalSpeechRecognition ? 'vosk' : 'native';
    const inputConfirmedNow = hasRecognizedMicrophoneCheck(recognizedText || '');
    if (listenModeSelection === 'pending' || !canBeginPreparedRehearsal(listenModeSelection, {
      speakerConfirmed: preparation.speakerConfirmed,
      microphoneCalibrated: Boolean(preparation.calibration),
      recognitionAudioActive: isRecognitionAudioActive || inputConfirmedNow,
      speakerWithRecognitionConfirmed: inputConfirmedNow || rehearsalPreparationSession.hasConfirmedRecognitionEngine(engineKey),
    })) {
      setRehearsalMediaStatus('Falta activar la escucha o completar las pruebas de audio.');
      return;
    }
    if (inputConfirmedNow) rehearsalPreparationSession.confirmRecognitionOutput(recognizedText!, engineKey);
    resetSpeechRecognitionTranscript();
    setAutoListenEnabled(listenModeSelection === 'auto'); setTemporarilySuspendingAutoListen(false);
    setHasCompletedRehearsalPreflight(true); setIsRehearsalMediaReady(true);
    setIsPreparingRehearsalMedia(false);
    setRehearsalPreflightPhase(null); setRehearsalMediaStatus(null);
  }, [isRecognitionAudioActive, listenModeSelection, resetSpeechRecognitionTranscript, recognitionEngine, isLocalSpeechRecognition]);

  const enableIntelligentListenForDevice = useCallback(() => {
    const preparation = rehearsalPreparationSession.getSnapshot();
    if (!preparation.speakerConfirmed || !preparation.calibration) return;
    stopRehearsalSpeech();
    setHasSubmittedWhisperCheck(false);
    setListenModeSelection('intelligent');
    setHasConfirmedRehearsalSetup(true);
    setAutoListenEnabled(false);
    setTemporarilySuspendingAutoListen(false);
    setIsRehearsalMediaReady(false);
    setIsPreparingRehearsalMedia(false);
    setHasPreparedRehearsalMedia(false);
    setHasCompletedRehearsalPreflight(false);
    setRehearsalPreflightPhase('intelligent-check');
    setRehearsalMediaStatus(null);
    setCompatibilityMessage(null);
    activateRecognition({ lang: 'es-ES', lineKey: recognitionPreparationKey });
  }, [activateRecognition, recognitionPreparationKey]);

  useEffect(() => {
    if (!isCheckingIntelligentRecognition || isRecognitionAudioActive) setHasSubmittedWhisperCheck(false);
  }, [isCheckingIntelligentRecognition, isRecognitionAudioActive]);

  useEffect(() => {
    if (!isCheckingIntelligentRecognition) return;
    const checkedText = usesWhisperRecognition(recognitionEngine) ? speechRecognitionTranscript : speechRecognitionFinalTranscript;
    if (hasRecognizedMicrophoneCheck(checkedText)) {
      finishRehearsalPreparation(checkedText);
      return;
    }
    const engineKey = usesWhisperRecognition(recognitionEngine) ? 'whisper' : isLocalSpeechRecognition ? 'vosk' : 'native';
    if (isRecognitionAudioActive && rehearsalPreparationSession.hasConfirmedRecognitionEngine(engineKey)) {
      finishRehearsalPreparation();
    }
  }, [finishRehearsalPreparation, isCheckingIntelligentRecognition, isRecognitionAudioActive, speechRecognitionFinalTranscript,
    recognitionEngine, speechRecognitionTranscript, isLocalSpeechRecognition]);

  const stopSongAudio = useCallback(() => {
    const player = audioRef.current;
    if (player) {
      player.pause();
      player.currentTime = 0;
      player.onended = null;
      player.onerror = null;
      player.ontimeupdate = null;
    }

    setPlayingAudioId(null);
    activeAudioPlaybackRef.current = null;
  }, []);

  const disposeCalibrationAudio = useCallback(() => {
    const player = calibrationAudioRef.current;
    calibrationAudioRef.current = null;
    if (!player) return;
    player.onended = player.onerror = null;
    player.pause();
    player.removeAttribute('src');
    player.load();
  }, []);

  const disposeSongAudio = useCallback(() => {
    const player = audioRef.current;
    if (player) {
      player.pause();
      player.currentTime = 0;
      player.onended = null;
      player.onerror = null;
      player.ontimeupdate = null;
      player.removeAttribute('src');
      player.load();
      audioRef.current = null;
    }

    if (songAudioSourceRef.current) {
      songAudioSourceRef.current.disconnect();
      songAudioSourceRef.current = null;
    }

    if (songAudioGainRef.current) {
      songAudioGainRef.current.disconnect();
      songAudioGainRef.current = null;
    }

    if (songAudioContextRef.current) {
      const context = songAudioContextRef.current;
      songAudioContextRef.current = null;
      void context.close().catch(() => undefined);
    }

    desiredSongAudioVolumeRef.current = 1;
    hasSongAudioGainFailedRef.current = false;
    setPlayingAudioId(null);
    activeAudioPlaybackRef.current = null;
  }, []);

  const stopStandaloneSongAudio = useCallback(() => {
    if (activeAudioPlaybackRef.current?.kind === 'song') {
      stopSongAudio();
    }
  }, [stopSongAudio]);

  const getSongAudioPlayer = useCallback(() => {
    if (typeof Audio === 'undefined') {
      return null;
    }

    if (!audioRef.current) {
      const nextPlayer = new Audio();
      nextPlayer.preload = 'auto';
      nextPlayer.crossOrigin = 'anonymous';
      nextPlayer.setAttribute('playsinline', 'true');
      audioRef.current = nextPlayer;
    }

    return audioRef.current;
  }, []);

  const ensureSongAudioOutput = useCallback(() => {
    const player = audioRef.current;
    if (!player || hasSongAudioGainFailedRef.current) {
      return null;
    }

    if (
      songAudioContextRef.current &&
      songAudioGainRef.current &&
      songAudioContextRef.current.state !== 'closed'
    ) {
      return {
        context: songAudioContextRef.current,
        gainNode: songAudioGainRef.current,
      };
    }

    if (songAudioContextRef.current?.state === 'closed') {
      songAudioContextRef.current = null;
      songAudioSourceRef.current = null;
      songAudioGainRef.current = null;
    }

    const AudioContextConstructor = getBrowserAudioContextConstructor();
    if (!AudioContextConstructor) {
      return null;
    }

    try {
      const context = songAudioContextRef.current ?? new AudioContextConstructor();
      const sourceNode =
        songAudioSourceRef.current ?? context.createMediaElementSource(player);
      const gainNode = context.createGain();

      gainNode.gain.value = desiredSongAudioVolumeRef.current;
      sourceNode.connect(gainNode);
      gainNode.connect(context.destination);

      songAudioContextRef.current = context;
      songAudioSourceRef.current = sourceNode;
      songAudioGainRef.current = gainNode;

      return { context, gainNode };
    } catch {
      hasSongAudioGainFailedRef.current = true;

      if (songAudioGainRef.current) {
        songAudioGainRef.current.disconnect();
        songAudioGainRef.current = null;
      }

      return null;
    }
  }, []);

  const prepareSongAudioOutput = useCallback(async () => {
    const output = ensureSongAudioOutput();
    if (!output) {
      return;
    }

    if (output.context.state === 'suspended') {
      await output.context.resume().catch(() => undefined);
    }
  }, [ensureSongAudioOutput]);

  const setSongAudioVolume = useCallback((nextVolume: number) => {
    const player = audioRef.current;
    if (!player) {
      return;
    }

    const safeVolume = Math.max(0, Math.min(nextVolume, 1));
    desiredSongAudioVolumeRef.current = safeVolume;

    const output = ensureSongAudioOutput();
    if (output) {
      const currentTime = output.context.currentTime;
      output.gainNode.gain.cancelScheduledValues(currentTime);
      output.gainNode.gain.setTargetAtTime(safeVolume, currentTime, 0.035);
      player.volume = 1;
      return;
    }

    player.volume = safeVolume;
  }, [ensureSongAudioOutput]);

  const primeSongPlayback = useCallback(async () => {
    const player = getSongAudioPlayer();
    if (!player) {
      return false;
    }

    const silentObjectUrl = createSilentWavObjectUrl();
    if (!silentObjectUrl) {
      return false;
    }

    try {
      const unlocked = await primeRehearsalAudioPlayer(player, silentObjectUrl, prepareSongAudioOutput);
      if (unlocked) setIsSongPlaybackUnlocked(true);
      return unlocked;
    } finally {
      URL.revokeObjectURL(silentObjectUrl);
    }
  }, [getSongAudioPlayer, prepareSongAudioOutput]);

  const getCalibrationAudioPlayer = useCallback(() => {
    if (typeof Audio === 'undefined') return null;
    if (!calibrationAudioRef.current) {
      const player = new Audio();
      player.preload = 'auto';
      player.setAttribute('playsinline', 'true');
      calibrationAudioRef.current = player;
    }
    return calibrationAudioRef.current;
  }, []);

  const playMicroCalibrationBeep = useCallback(async () => {
    // Keep the cue outside the song player's MediaElementAudioSource/GainNode.
    // Its audio context can be interrupted when the microphone changes route.
    const player = getCalibrationAudioPlayer();
    const toneObjectUrl = createMicroCalibrationToneObjectUrl();

    if (!player || !toneObjectUrl) {
      if (toneObjectUrl) URL.revokeObjectURL(toneObjectUrl);
      throw new Error('calibration-beep-unavailable');
    }

    try {
      player.volume = 1;
      await playCalibrationBeep(player, toneObjectUrl, async () => {});
    } finally {
      URL.revokeObjectURL(toneObjectUrl);
    }
  }, [getCalibrationAudioPlayer]);

  const goBackLine = useCallback(() => {
    stopRehearsalSpeech();
    stopStandaloneSongAudio();
    const lastAutoAdvance = lastIntelligentAutoAdvanceRef.current;

    if (lastAutoAdvance?.toIndex === currentIndex) {
      setPendingInvalidAutoAdvance(lastAutoAdvance.entry);
    }

    setCurrentIndex((previousIndex) => Math.max(0, previousIndex - 1));
  }, [currentIndex, stopStandaloneSongAudio]);

  useEffect(() => {
    const safeInitialIndex = Math.max(0, Math.min(initialIndex, filteredGuion.length));
    setCurrentIndex(safeInitialIndex);
  }, [filteredGuion, initialIndex]);

  useEffect(() => {
    onProgressChange?.(Math.min(currentIndex, filteredGuion.length), filteredGuion.length);
  }, [currentIndex, filteredGuion.length, onProgressChange]);

  useEffect(() => {
    let isMounted = true;

    const loadRehearsalPreferences = async () => {
      try {
        const [storedListenMode, storedAudioMode, storedTranscript, storedEngine] = await Promise.all([
          AsyncStorage.getItem(REHEARSAL_LISTEN_MODE_STORAGE_KEY),
          AsyncStorage.getItem(REHEARSAL_AUDIO_MODE_STORAGE_KEY),
          AsyncStorage.getItem(REHEARSAL_TRANSCRIPT_STORAGE_KEY),
          AsyncStorage.getItem(REHEARSAL_RECOGNITION_ENGINE_STORAGE_KEY),
        ]);

        if (!isMounted) {
          return;
        }

        setListenModeSelection(resolveListenPreference(storedListenMode, isSpeechRecognitionSupported));
        setShowTranscript(resolveTranscriptPreference(storedTranscript));
        setRecognitionEngine(resolveRecognitionEngine(storedEngine));

        if (isSharedSongAudioKind(storedAudioMode)) {
          setRehearsalAudioModeSelection(storedAudioMode);
        }
      } catch (error) {
        console.error('Error cargando preferencias de ensayo', error);
      } finally {
        if (isMounted) setPreferencesLoaded(true);
      }
    };

    void loadRehearsalPreferences();

    return () => {
      isMounted = false;
    };
  }, [isSpeechRecognitionSupported]);

  useEffect(() => {
    let isMounted = true;

    const loadLineVariants = async () => {
      try {
        const storedVariants = await AsyncStorage.getItem(
          `${INTELLIGENT_LINE_VARIANTS_STORAGE_PREFIX}${resolvedScriptId}`
        );

        if (!isMounted) {
          return;
        }

        if (!storedVariants) {
          setLineVariants({});
          return;
        }

        const parsedVariants = JSON.parse(storedVariants) as LineVariantMap;
        setLineVariants(
          parsedVariants && typeof parsedVariants === 'object' && !Array.isArray(parsedVariants)
            ? parsedVariants
            : {}
        );
      } catch (error) {
        console.error('Error cargando variantes de lineas', error);
        setLineVariants({});
      }
    };

    void loadLineVariants();

    return () => {
      isMounted = false;
    };
  }, [resolvedScriptId]);

  useEffect(() => {
    let isMounted = true;
    setHasLoadedRehearsalAudioSelections(false);

    const loadRehearsalAudioSelections = async () => {
      try {
        const storedSelections = await AsyncStorage.getItem(
          `${REHEARSAL_AUDIO_SELECTION_STORAGE_PREFIX}${resolvedScriptId}`
        );

        if (!isMounted) {
          return;
        }

        if (!storedSelections) {
          selectedRehearsalAudioIdsRef.current = {};
          setSelectedRehearsalAudioIds({});
          setHasLoadedRehearsalAudioSelections(true);
          return;
        }

        const parsedSelections = JSON.parse(storedSelections) as RehearsalAudioSelectionMap;
        const nextSelections =
          parsedSelections &&
          typeof parsedSelections === 'object' &&
          !Array.isArray(parsedSelections)
            ? Object.fromEntries(
                Object.entries(parsedSelections).filter(
                  ([selectionKey, audioId]) =>
                    typeof selectionKey === 'string' && typeof audioId === 'string'
                )
              )
            : {};

        selectedRehearsalAudioIdsRef.current = nextSelections;
        setSelectedRehearsalAudioIds(nextSelections);
        setHasLoadedRehearsalAudioSelections(true);
      } catch (error) {
        console.error('Error cargando seleccion de audios de ensayo', error);
        selectedRehearsalAudioIdsRef.current = {};
        setSelectedRehearsalAudioIds({});
        setHasLoadedRehearsalAudioSelections(true);
      }
    };

    void loadRehearsalAudioSelections();

    return () => {
      isMounted = false;
    };
  }, [resolvedScriptId]);

  useEffect(() => {
    setAudioError(null);
    setBlockedAutoplayAudio(null);
  }, [currentMusicalNumberKey, currentSongKey]);

  useEffect(() => {
    let isMounted = true;

    const loadAudioCompatibility = async () => {
      try {
        const [storedMode, legacyStoredMode] = await Promise.all([
          AsyncStorage.getItem(REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY),
          AsyncStorage.getItem(LEGACY_REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY),
        ]);
        if (!isMounted) {
          return;
        }

        if (legacyStoredMode) {
          await AsyncStorage.removeItem(LEGACY_REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY);
        }

        if (storedMode === 'manual-disabled') {
          setCompatibilityMessage(
            'En este dispositivo has desactivado la escucha automatica porque la voz del resto no se escuchaba bien.'
          );
          return;
        }

        setAutoListenEnabled(true);
        setTemporarilySuspendingAutoListen(false);
        setCompatibilityMessage(null);

        if (storedMode === 'disabled' || storedMode === 'enabled') {
          await AsyncStorage.removeItem(REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY);
        }
      } catch (error) {
        console.error('Error cargando compatibilidad de audio', error);
      }
    };

    void loadAudioCompatibility();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (isMyTurn || isFinished || !currentLine || isSceneMarker(currentLine) || isSongCue(currentLine)) {
      setSpeechStatusMessage(null);
      setTemporarilySuspendingAutoListen(false);
    }
  }, [currentLine, isFinished, isMyTurn]);

  useEffect(() => {
    if (rehearsalPreflightPhase === 'micro-calibration') {
      return;
    }

    if (!effectiveAutoListenEnabled) {
      if (isListeningActive) {
        void stopListening();
      }
      return;
    }

    if (shouldArmListeningForCurrentLine) {
      if (!isListeningActive && listeningStatus !== 'requesting' && listeningStatus !== 'error') {
        let cancelled = false;
        // Switching from Intelligent can leave its last native request
        // finishing. Never open getUserMedia on top of that recognizer.
        void waitForRecognitionEnd().then((ended) => {
          if (cancelled || !isPageVisible()) return;
          if (ended) void startListening();
          else setCompatibilityMessage('La escucha anterior de Safari aún no ha terminado. Vuelve a iniciar el ensayo para reintentarlo.');
        });
        return () => { cancelled = true; };
      }
      return;
    }

    if (shouldSuspendListeningDuringSong) {
      if (isListeningActive || listeningStatus === 'requesting') {
        void releaseListeningInput();
      }
      return;
    }

    if (isListeningActive) {
      void stopListening();
    }
  }, [
    effectiveAutoListenEnabled,
    isListeningActive,
    listeningStatus,
    releaseListeningInput,
    rehearsalPreflightPhase,
    shouldSuspendListeningDuringSong,
    shouldArmListeningForCurrentLine,
    startListening,
    waitForRecognitionEnd,
    stopListening,
  ]);

  const getAdaptiveRehearsalSpeechRate = useCallback(() => {
    const activePlayback = activeAudioPlaybackRef.current;
    const player = audioRef.current;

    if (
      !currentMusicalNumber ||
      !currentLine ||
      currentLineIndexInScript < 0 ||
      !activePlayback ||
      activePlayback.kind !== 'musical-number' ||
      activePlayback.ownerId !== currentMusicalNumber.id ||
      !activePlayback.timelineCues.length ||
      !player
    ) {
      return defaultRehearsalSpeechRate;
    }

    const currentTimeMs = Math.max(0, Math.round(player.currentTime * 1000));
    const upcomingCue = activePlayback.timelineCues.find(
      (cue) =>
        cue.atMs > currentTimeMs + TIMELINE_CUE_SAFETY_MS &&
        cue.targetLineIndex > currentLineIndexInScript
    );

    if (!upcomingCue) {
      return defaultRehearsalSpeechRate;
    }

    const targetFilteredIndex = filteredGuion.findIndex(
      (line) => guion.indexOf(line) >= upcomingCue.targetLineIndex
    );

    if (targetFilteredIndex <= currentIndex) {
      return defaultRehearsalSpeechRate;
    }

    const futureEstimatedMs = filteredGuion
      .slice(currentIndex + 1, targetFilteredIndex)
      .reduce((totalMs, line) => {
        if (!line || isSceneMarker(line) || isSongCue(line)) {
          return totalMs;
        }

        const lineText = line.t?.replace(/\s+/g, ' ').trim() ?? '';
        if (!lineText) {
          return totalMs + 200;
        }

        if (lineMatchesRoles(line, myRoles)) {
          return (
            totalMs +
            estimateSpeechDurationMs(lineText, USER_SPEECH_WORDS_PER_SECOND) +
            USER_LINE_RESPONSE_BUFFER_MS
          );
        }

        return (
          totalMs +
          estimateSpeechDurationMs(
            lineText,
            APP_SPEECH_WORDS_PER_SECOND,
            defaultRehearsalSpeechRate
          ) +
          APP_LINE_ADVANCE_DELAY_MS
        );
      }, 0);

    const remainingBudgetMs = upcomingCue.atMs - currentTimeMs - TIMELINE_CUE_SAFETY_MS;
    const availableForCurrentLineMs = remainingBudgetMs - futureEstimatedMs;

    if (!Number.isFinite(availableForCurrentLineMs) || availableForCurrentLineMs <= 0) {
      return maxTimedRehearsalSpeechRate;
    }

    const currentLineBaseDurationMs = estimateSpeechDurationMs(
      speakableLineText,
      APP_SPEECH_WORDS_PER_SECOND
    );
    return clampSpeechRate(
      currentLineBaseDurationMs / availableForCurrentLineMs,
      minTimedRehearsalSpeechRate,
      maxTimedRehearsalSpeechRate
    );
  }, [
    currentIndex,
    currentLine,
    currentLineIndexInScript,
    currentMusicalNumber,
    defaultRehearsalSpeechRate,
    filteredGuion,
    guion,
    maxTimedRehearsalSpeechRate,
    minTimedRehearsalSpeechRate,
    myRoles,
    speakableLineText,
  ]);

  useEffect(() => {
    if (!canRunRehearsalLinePlayback || isSceneMarker(currentLine) || isMyTurn) {
      return;
    }

    stopRehearsalSpeech();
    stopStandaloneSongAudio();
    let isCancelled = false;
    let advanceTimeout: ReturnType<typeof setTimeout> | null = null;

    if (isFinished || !currentLine || isSceneMarker(currentLine) || isSongCue(currentLine) || isMyTurn) {
      return () => {
        stopRehearsalSpeech();
        stopStandaloneSongAudio();
      };
    }

    if (!speakableLineText) {
      advanceTimeout = setTimeout(advanceLine, 80);
      return () => {
        if (advanceTimeout) {
          clearTimeout(advanceTimeout);
        }
        stopRehearsalSpeech();
        stopStandaloneSongAudio();
      };
    }

    if (autoListenEnabled && !temporarilySuspendingAutoListen) {
      setSpeechStatusMessage('Preparando la voz de Siri para la siguiente linea...');
      setTemporarilySuspendingAutoListen(true);
      return;
    }

    if (temporarilySuspendingAutoListen && (isListeningActive || listeningStatus === 'requesting')) {
      setSpeechStatusMessage('Liberando el micro para reproducir la siguiente linea...');
      return;
    }

    const requestedAt = Date.now();
    let inputReadyAt = requestedAt;
    let speechRequestedAt = requestedAt;
    let inputEndReason = '';
    const responseEntry = lastIntelligentAutoAdvanceRef.current?.toIndex === currentIndex && !lastIntelligentAutoAdvanceRef.current.entry.responseTiming
      ? lastIntelligentAutoAdvanceRef.current.entry : null;
    const preparedSpeech = prepareRehearsalSpeech(speakableLineText, {
      onStart: () => {
        if (isCancelled) return;
        if (responseEntry) {
          const responseTiming = getRehearsalResponseTiming(responseEntry.createdAt, requestedAt,
            inputReadyAt, speechRequestedAt, Date.now(), getNativePrototypeInfo() ? 'native_bridge' : undefined);
          if (responseTiming) {
            const updated = { ...responseEntry, responseTiming };
            setIntelligentFeedbackEntries(entries => entries.map(entry => entry === responseEntry ? updated : entry));
            if (lastIntelligentAutoAdvanceRef.current?.entry === responseEntry) lastIntelligentAutoAdvanceRef.current.entry = updated;
          }
        }
        setSpeechStatusMessage(
          `Reproduciendo la linea. Fin de entrada: ${inputReadyAt - requestedAt} ms (${inputEndReason}). Inicio de voz: ${Date.now() - speechRequestedAt} ms.`
        );
      },
      onDone: () => {
        if (isCancelled) return;
        notifyRecognitionPlaybackEnd();
        const finishLine = () => {
          if (isCancelled || !isPageVisible()) return;
          setSpeechStatusMessage('Linea reproducida. Avanzando...');
          advanceTimeout = setTimeout(advanceLine, APP_LINE_ADVANCE_DELAY_MS);
        };
        const nextLine = filteredGuion[currentIndex + 1];
        const nextLineNeedsInput = listenModeSelection !== 'manual' && nextLine &&
          !isSceneMarker(nextLine) && !isSongCue(nextLine) && lineMatchesRoles(nextLine, myRoles);
        if (nextLineNeedsInput) {
          // A very short reply may finish before the old service does. Keep
          // the next actor turn closed until it is safe to open a fresh input.
          setSpeechStatusMessage('Replica reproducida. Preparando tu escucha...');
          void waitForRecognitionEnd().then((ended) => {
            if (isCancelled) return;
            if (ended) finishLine();
            else setSpeechStatusMessage('Safari no ha terminado la escucha anterior. Pulsa siguiente para continuar.');
          });
        } else finishLine();
      },
      onError: (error) => {
        if (!isCancelled) setSpeechStatusMessage(`Siri ha fallado al reproducir esta linea (${error.message}).`);
      },
    });

    const playOtherLine = async () => {
      stopRecognition();
      if (!await waitForRecognitionInputEnd()) {
        if (!isCancelled) setSpeechStatusMessage('Safari no ha indicado el final de la entrada anterior. Pulsa siguiente para continuar.');
        return;
      }
      if (isCancelled || !isPageVisible()) return;
      if (temporarilySuspendingAutoListen) {
        await releaseListeningInput();
        if (isCancelled) {
          return;
        }
      }

      if (isCancelled || !isPageVisible()) return;
      inputReadyAt = Date.now();
      inputEndReason = getRecognitionInputEndReason();
      setSpeechStatusMessage(`Entrada finalizada en ${inputReadyAt - requestedAt} ms. Lanzando la linea...`);
      speechRequestedAt = Date.now();
      preparedSpeech.start(getAdaptiveRehearsalSpeechRate());
    };

    void playOtherLine();

    return () => {
      isCancelled = true;
      if (advanceTimeout) {
        clearTimeout(advanceTimeout);
      }
      void stopListening();
      preparedSpeech.cancel();
      stopStandaloneSongAudio();
    };
  }, [
    advanceLine,
    autoListenEnabled,
    canRunRehearsalLinePlayback,
    currentLine,
    currentIndex,
    filteredGuion,
    listenModeSelection,
    myRoles,
    temporarilySuspendingAutoListen,
    isFinished,
    isListeningActive,
    listeningStatus,
    isMyTurn,
    getAdaptiveRehearsalSpeechRate,
    speakableLineText,
    stopListening,
    releaseListeningInput,
    stopRecognition,
    waitForRecognitionInputEnd,
    waitForRecognitionEnd,
    getRecognitionInputEndReason,
    notifyRecognitionPlaybackEnd,
    stopStandaloneSongAudio,
  ]);

  useEffect(() => {
    setSceneCommandReadyKey(null);
    setSceneAnnouncementError(null);
    if (!canRunRehearsalLinePlayback || !currentSceneTransitionKey || !currentLine) return;

    stopRehearsalSpeech();
    stopSongAudio();
    stopRecognition();
    resetSpeechRecognitionTranscript();
    return startRehearsalSceneAnnouncement({
      title: currentLine.t,
      releaseInput: async () => {
        await releaseListeningInput();
        if (!await waitForRecognitionEnd()) throw new Error('recognition-did-not-end');
        if (!isPageVisible()) throw new Error('page-hidden');
      },
      speak: speakRehearsalSpeech,
      stop: stopRehearsalSpeech,
      onReady: (error) => {
        if (!error) notifyRecognitionPlaybackEnd();
        resetSpeechRecognitionTranscript();
        setSceneAnnouncementError(error ? 'No se ha podido anunciar la escena por voz.' : null);
        setSceneCommandReadyKey(currentSceneTransitionKey);
      },
    });
  }, [canRunRehearsalLinePlayback, currentLine, currentSceneTransitionKey, releaseListeningInput,
    notifyRecognitionPlaybackEnd, resetSpeechRecognitionTranscript, stopRecognition, stopSongAudio, waitForRecognitionEnd]);

  useEffect(() => () => {
    disposeSongAudio();
    disposeCalibrationAudio();
  }, [disposeCalibrationAudio, disposeSongAudio]);

  const handleExit = () => {
    if (exitRequestedRef.current) return;
    exitRequestedRef.current = true;
    setIsExitingRehearsal(true);
    setIsPaused(true);
    preparationRunRef.current += 1;
    stopRehearsalSpeech();
    disposeSongAudio();
    disposeCalibrationAudio();
    finishComparison('exit');
    stopRecognition();
    void releaseListening();
    void waitForRecognitionEnd().then(async () => { await persistComparisonDraft(feedbackEntriesRef.current).catch(() => {}); onExit(); });
  };

  const currentAudioModeLabel = currentMusicalNumber ? 'numero musical' : 'cancion';
  const shouldShowCurrentAudioOptions = currentRehearsalAudioOptions.length > 0;

  const prepareRehearsalMedia = useCallback(() => {
    const run = ++preparationRunRef.current;
    stopSongAudio();
    setIsPreparingRehearsalMedia(true);
    setHasPreparedRehearsalMedia(false);
    setRehearsalMediaStatus('Escucha la frase de prueba.');
    setRehearsalPreflightPhase('audio-check');
    // Synthesis starts in this tap, before any await, to unlock Safari output.
    const finish = (error = false) => {
      if (preparationRunRef.current !== run) return;
      setIsPreparingRehearsalMedia(false);
      setHasPreparedRehearsalMedia(!error);
      setRehearsalMediaStatus(error
        ? 'No se pudo completar la prueba de voz. Pulsa Probar voz para reiniciarla.'
        : '¿Has oído claramente la frase de la app?');
    };
    void playCalibrationVoice('Hola, hola, dime si me oyes.', {
      speak: (text, callbacks) => speakRehearsalSpeech(text, {
        ...callbacks,
        // Restore the cold-start reset used by the working speaker check,
        // without adding cancellations or delays between rehearsal lines.
        resetBeforeStart: true,
        onStart: () => {
          if (preparationRunRef.current === run) {
            setRehearsalMediaStatus('Prueba en curso: «Hola, hola, dime si me oyes».');
          }
        },
      }),
      stop: () => { if (preparationRunRef.current === run) stopRehearsalSpeech(); },
    }).then(() => finish(), () => finish(true));
  }, [stopSongAudio]);

  const calibrateRehearsalMicrophone = useCallback(async () => {
    const run = ++preparationRunRef.current;
    const isCurrent = () => preparationRunRef.current === run;
    stopRehearsalSpeech(); stopSongAudio(); disposeCalibrationAudio(); stopRecognition();
    setIsPreparingRehearsalMedia(true); setHasPreparedRehearsalMedia(false);
    setHasCompletedRehearsalPreflight(false); setIsRehearsalMediaReady(false);
    setRehearsalPreflightPhase('micro-calibration'); setAutoListenEnabled(false);
    setRehearsalMediaStatus('Guarda silencio: vamos a medir el ruido de fondo.');
    setSpeakerConfirmed(rehearsalPreparationSession.getSnapshot().speakerConfirmed);
    setMicrophoneCalibrated(false);
    resetMicrophoneCalibration();
    try {
      const result = await runRehearsalMicrophoneCalibration({
        isCurrent,
        prepareOutput: async () => {
          // The actor already heard and confirmed the voice, with no microphone
          // open. This tap only unlocks the separate native cue player.
          const player = getCalibrationAudioPlayer();
          const silentUrl = createSilentWavObjectUrl();
          if (!player || !silentUrl) {
            if (silentUrl) URL.revokeObjectURL(silentUrl);
            throw new Error('calibration-beep-unavailable');
          }
          try {
            if (!await primeRehearsalAudioPlayer(player, silentUrl, async () => {})) {
              throw new Error('calibration-beep-unavailable');
            }
          } finally { URL.revokeObjectURL(silentUrl); }
        },
        start: startListening, measureNoise: calibrateAmbientNoise,
        prompt: () => playCalibrationVoice('Di prueba de micro después del pitido.', {
          speak: speakRehearsalSpeech, stop: () => { if (isCurrent()) stopRehearsalSpeech(); },
        }),
        beep: playMicroCalibrationBeep, measureVoice: () => calibrateVoiceLevel(2200),
        release: releaseListeningInput,
        onStage: (stage) => setRehearsalMediaStatus(stage === 'silence'
          ? 'Guarda silencio: estamos midiendo el ruido de fondo.'
          : stage === 'prompt' ? 'Después del pitido, di «prueba de micro».'
          : 'Habla ahora: «prueba de micro». Estamos midiendo tu voz.'),
      });
      if (!isCurrent()) return;
      rehearsalPreparationSession.rememberCalibration(result);
      setMicrophoneCalibrated(true);
      const speakerAlreadyConfirmed = rehearsalPreparationSession.getSnapshot().speakerConfirmed;
      setSpeakerConfirmed(speakerAlreadyConfirmed);
      setRehearsalPreflightPhase(speakerAlreadyConfirmed
        ? listenModeSelection === 'intelligent' ? 'ready-to-listen' : 'ready-to-start'
        : 'audio-check');
      setRehearsalMediaStatus(speakerAlreadyConfirmed ? null : result.status === 'weak'
        ? 'Micro calibrado. Habla cerca del teléfono para que tu voz destaque sobre el ruido.'
        : 'Micro calibrado. Ahora pulsa Probar voz para comprobar el altavoz.');
    } catch (error) {
      if (!isCurrent()) return;
      stopRehearsalSpeech();
      disposeCalibrationAudio();
      setRehearsalMediaStatus(error instanceof Error && error.message === 'calibration-voice-unavailable'
        ? 'No se ha podido reproducir la voz. Pulsa Reintentar calibración para activar el audio.'
        : error instanceof Error && error.message === 'calibration-beep-unavailable'
        ? 'No se ha podido reproducir el pitido. Pulsa Reintentar calibración para activar el audio.'
        : error instanceof Error && error.message === 'voice-not-detected'
        ? 'No se ha detectado suficiente voz. Repite la calibración y habla después del pitido.'
        : 'No se pudo calibrar el micrófono. Comprueba el permiso del navegador y vuelve a intentarlo.');
    } finally {
      if (isCurrent()) setIsPreparingRehearsalMedia(false);
    }
  }, [calibrateAmbientNoise, calibrateVoiceLevel, disposeCalibrationAudio, getCalibrationAudioPlayer,
    listenModeSelection, playMicroCalibrationBeep, releaseListeningInput, resetMicrophoneCalibration,
    startListening, stopRecognition, stopSongAudio]);

  const advancePastMusicalNumber = useCallback((musicalNumberId: string | null) => {
    const musicalNumber = musicalNumberId
      ? musicalNumbers.find((candidate) => candidate.id === musicalNumberId)
      : null;

    if (!musicalNumber) {
      advanceLine();
      return;
    }

    setCurrentIndex((previousIndex) => {
      const currentScriptIndex = filteredGuion[previousIndex]
        ? guion.indexOf(filteredGuion[previousIndex])
        : -1;

      if (currentScriptIndex > musicalNumber.endLineIndex) {
        return previousIndex;
      }

      const nextLineIndex = filteredGuion.findIndex(
        (line) => guion.indexOf(line) > musicalNumber.endLineIndex
      );

      return getAutomaticRehearsalTargetIndex(
        filteredGuion, previousIndex, nextLineIndex >= 0 ? nextLineIndex : filteredGuion.length
      );
    });
  }, [advanceLine, filteredGuion, guion, musicalNumbers]);

  const jumpToScriptLineIndex = useCallback((targetLineIndex: number) => {
    setCurrentIndex((previousIndex) => {
      const exactTargetIndex = filteredGuion.findIndex(
        (line) => guion.indexOf(line) === targetLineIndex
      );
      const fallbackTargetIndex = exactTargetIndex >= 0
        ? exactTargetIndex
        : filteredGuion.findIndex((line) => guion.indexOf(line) > targetLineIndex);

      if (fallbackTargetIndex < 0 || fallbackTargetIndex <= previousIndex) {
        return previousIndex;
      }

      return getAutomaticRehearsalTargetIndex(filteredGuion, previousIndex, fallbackTargetIndex);
    });
  }, [filteredGuion, guion]);

  const handlePlaySongAudio = useCallback((
    audioUrl: string,
    audioId: string,
    options?: {
      advanceOnEnd?: boolean;
      autoStart?: boolean;
      playbackKind?: 'song' | 'musical-number';
      ownerId?: string | null;
      rememberForSelectionKey?: string | null;
      timelineCues?: MusicalTimelineCue[];
    }
  ) => {
    const player = getSongAudioPlayer();
    if (!player) {
      setAudioError('La reproduccion de audio solo esta disponible en la app web.');
      return;
    }

    if (playingAudioId === audioId && !player.paused) {
      stopSongAudio();
      return;
    }

    setAudioError(null);
    setBlockedAutoplayAudio(null);
    stopSongAudio();
    rememberRehearsalAudioSelection(options?.rememberForSelectionKey, audioId);

    player.onended = () => {
      setPlayingAudioId(null);
      activeAudioPlaybackRef.current = null;
      player.ontimeupdate = null;
      if (options?.playbackKind === 'musical-number') {
        autoStartedMusicalNumberKeyRef.current = null;
        advancePastMusicalNumber(options.ownerId ?? null);
        return;
      }

      if (options?.advanceOnEnd) {
        advanceLine();
      }
    };
    player.onerror = () => {
      setPlayingAudioId(null);
      activeAudioPlaybackRef.current = null;
      player.ontimeupdate = null;
      setAudioError('No se pudo reproducir este audio.');
    };
    player.ontimeupdate = () => {
      const activePlayback = activeAudioPlaybackRef.current;
      if (
        !activePlayback ||
        activePlayback.kind !== 'musical-number' ||
        activePlayback.ownerId !== options?.ownerId ||
        !activePlayback.timelineCues.length
      ) {
        return;
      }

      const currentTimeMs = Math.max(0, Math.round(player.currentTime * 1000));
      const dueCue = activePlayback.timelineCues.find((cue) => {
        const cueKey = cue.id || `${cue.targetLineIndex}:${cue.atMs}`;
        return cue.atMs <= currentTimeMs + 120 && !activePlayback.firedTimelineCueIds.has(cueKey);
      });

      if (!dueCue) {
        return;
      }

      const cueKey = dueCue.id || `${dueCue.targetLineIndex}:${dueCue.atMs}`;
      activePlayback.firedTimelineCueIds.add(cueKey);
      stopRehearsalSpeech();
      setSpeechStatusMessage(null);
      setTemporarilySuspendingAutoListen(false);
      jumpToScriptLineIndex(dueCue.targetLineIndex);
    };

    player.src = audioUrl;
    player.load();
    setSongAudioVolume(1);
    setPlayingAudioId(audioId);
    activeAudioPlaybackRef.current = {
      kind: options?.playbackKind ?? 'song',
      ownerId: options?.ownerId ?? null,
      audioId,
      timelineCues: (options?.timelineCues ?? [])
        .filter((cue) => cue.atMs >= 0 && cue.targetLineIndex >= 0)
        .sort((leftCue, rightCue) => leftCue.atMs - rightCue.atMs),
      firedTimelineCueIds: new Set(),
    };

    void prepareSongAudioOutput().then(() => player.play()).catch((error: unknown) => {
      setPlayingAudioId(null);
      activeAudioPlaybackRef.current = null;
      if (options?.autoStart && isAutoplayBlockedError(error)) {
        setBlockedAutoplayAudio({
          audioId,
          audioUrl,
          playbackKind: options?.playbackKind,
          ownerId: options?.ownerId ?? null,
          advanceOnEnd: options?.advanceOnEnd,
          selectionKey: options?.rememberForSelectionKey ?? null,
          timelineCues: options?.timelineCues,
        });
        setAudioError(
          isSongPlaybackUnlocked
            ? 'Safari ha vuelto a bloquear el audio automatico de esta cancion.'
            : 'Safari o iPhone necesita que actives el audio manualmente para esta cancion.'
        );
        return;
      }

      setAudioError('No se pudo reproducir este audio.');
    });
  }, [
    advancePastMusicalNumber,
    advanceLine,
    getSongAudioPlayer,
    isAutoplayBlockedError,
    isSongPlaybackUnlocked,
    jumpToScriptLineIndex,
    playingAudioId,
    prepareSongAudioOutput,
    rememberRehearsalAudioSelection,
    setSongAudioVolume,
    stopSongAudio,
  ]);

  useEffect(() => {
    if (!canStartRehearsalAudio) {
      return;
    }

    if (!hasLoadedRehearsalAudioSelections || shouldAskForRehearsalAudioChoice) {
      return;
    }

    if (!currentMusicalNumber) {
      autoStartedMusicalNumberKeyRef.current = null;
      if (activeAudioPlaybackRef.current?.kind === 'musical-number') {
        stopSongAudio();
      }
      return;
    }

    const activePlayback = activeAudioPlaybackRef.current;
    const isCurrentMusicalNumberPlaying =
      activePlayback?.kind === 'musical-number' &&
      activePlayback.ownerId === currentMusicalNumber.id &&
      playingAudioId !== null;

    if (
      activePlayback?.kind === 'musical-number' &&
      activePlayback.ownerId !== currentMusicalNumber.id
    ) {
      stopSongAudio();
    }

    if (!preferredMusicalNumberAudio) {
      return;
    }

    if (isCurrentMusicalNumberPlaying) {
      return;
    }

    if (autoStartedMusicalNumberKeyRef.current === currentMusicalNumberKey) {
      return;
    }

    autoStartedMusicalNumberKeyRef.current = currentMusicalNumberKey;
    handlePlaySongAudio(preferredMusicalNumberAudio.audioUrl, preferredMusicalNumberAudio.id, {
      autoStart: true,
      playbackKind: 'musical-number',
      ownerId: currentMusicalNumber.id,
      timelineCues: preferredMusicalNumberAudio.timelineCues ?? [],
    });
  }, [
    canStartRehearsalAudio,
    currentMusicalNumber,
    currentMusicalNumberKey,
    handlePlaySongAudio,
    hasLoadedRehearsalAudioSelections,
    playingAudioId,
    preferredMusicalNumberAudio,
    shouldAskForRehearsalAudioChoice,
    stopSongAudio,
  ]);

  useEffect(() => {
    const activePlayback = activeAudioPlaybackRef.current;
    if (activePlayback?.kind !== 'musical-number' || !activePlayback.ownerId) {
      return;
    }

    const activeMusicalNumber = musicalNumbers.find(
      (musicalNumber) => musicalNumber.id === activePlayback.ownerId
    );

    const isStillInsideActiveMusicalNumber = activeMusicalNumber
      ? currentLineIndexInScript >= activeMusicalNumber.startLineIndex &&
        currentLineIndexInScript <= activeMusicalNumber.endLineIndex
      : false;

    if (isStillInsideActiveMusicalNumber) {
      return;
    }

    autoStartedMusicalNumberKeyRef.current = null;
    stopSongAudio();
  }, [currentLineIndexInScript, musicalNumbers, stopSongAudio]);

  useEffect(() => {
    const activePlayback = activeAudioPlaybackRef.current;
    if (
      activePlayback?.kind !== 'musical-number' ||
      activePlayback.ownerId !== currentMusicalNumber?.id
    ) {
      return;
    }

    if (isCurrentMusicalSongBlock) {
      setSongAudioVolume(1);
      return;
    }

    if (isMyTurn) {
      setSongAudioVolume(0.18);
      return;
    }

    setSongAudioVolume(0.34);
  }, [currentMusicalNumber?.id, isCurrentMusicalSongBlock, isMyTurn, setSongAudioVolume]);

  useEffect(() => {
    if (!canStartRehearsalAudio) {
      return;
    }

    if (!hasLoadedRehearsalAudioSelections || shouldAskForRehearsalAudioChoice) {
      return;
    }

    if (!currentSongKey) {
      autoStartedSongKeyRef.current = null;
      return;
    }

    if (currentMusicalNumber) {
      return;
    }

    if (!currentSongAsset || !preferredSongAudio) {
      return;
    }

    if (autoStartedSongKeyRef.current === currentSongKey) {
      return;
    }

    autoStartedSongKeyRef.current = currentSongKey;
    handlePlaySongAudio(preferredSongAudio.audioUrl, preferredSongAudio.id, {
      advanceOnEnd: true,
      autoStart: true,
    });
  }, [
    canStartRehearsalAudio,
    currentMusicalNumber,
    currentSongAsset,
    currentSongKey,
    handlePlaySongAudio,
    hasLoadedRehearsalAudioSelections,
    preferredSongAudio,
    shouldAskForRehearsalAudioChoice,
  ]);

  const handleSelectRecognitionEngine = useCallback(async (next: RecognitionEngine) => {
    if (next === recognitionEngine) return;
    const run = ++preparationRunRef.current;
    finishComparison('manual');
    stopRehearsalSpeech(); stopSongAudio(); disposeCalibrationAudio(); stopRecognition();
    setHasConfirmedRehearsalSetup(false); setHasCompletedRehearsalPreflight(false);
    setIsRehearsalMediaReady(false); setRehearsalPreflightPhase(null);
    setIsPreparingRehearsalMedia(false); setHasPreparedRehearsalMedia(false); setAutoListenEnabled(false);
    void releaseListeningInput();
    // Changing adapters must not abort a native iOS request that is still
    // closing. A fresh tap will activate the chosen engine after it ends.
    if (!await waitForRecognitionEnd()) {
      if (preparationRunRef.current === run) setCompatibilityMessage('Safari aún está cerrando la escucha anterior. Reintenta el cambio de reconocimiento.');
      return;
    }
    if (preparationRunRef.current !== run || exitRequestedRef.current) return;
    setRecognitionEngine(next); setIsPaused(false); setCompatibilityMessage(null); setShowMicrophoneMenu(false);
    void AsyncStorage.setItem(REHEARSAL_RECOGNITION_ENGINE_STORAGE_KEY, next).catch(() => setPreferenceNotice('El reconocimiento elegido sigue activo, pero no se pudo recordar.'));
  }, [recognitionEngine, disposeCalibrationAudio, releaseListeningInput, stopRecognition, stopSongAudio, waitForRecognitionEnd, finishComparison]);

  const renderHeader = (title: string) => <>
    <View style={[ui.header, { paddingVertical: 10 }]}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cerrar ensayo" onPress={handleExit} style={ui.icon}><Icon name="arrow-left" /></TouchableOpacity>
      <View style={{ flex: 1, gap: 3 }}><Text numberOfLines={1} style={[ui.text, { fontSize: 12 }]}>{title}</Text><Text numberOfLines={1} style={{ color: palette.ink, fontWeight: '600' }}>{scriptTitle || 'Ensayo'}</Text></View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Micrófono y voz" onPress={() => setShowMicrophoneMenu(true)} style={[ui.row, { gap: 4, minHeight: 46 }]}>
        <Icon name={listenModeSelection === 'manual' ? 'microphone-off' : 'microphone-outline'} size={20} />
        <Text style={{ color: palette.plum, fontSize: 12, fontWeight: '700' }}>{listenModeSelection === 'intelligent' ? recognitionEngine === 'comparison' ? 'Comparativa' : 'Inteligente' : listenModeSelection === 'auto' ? 'Silencio' : 'Manual'} ⌄</Text>
      </TouchableOpacity>
    </View>
    {!showMicrophoneMenu ? renderIntelligentFeedbackBar() : null}
    <Sheet title="Micrófono y voz" visible={showMicrophoneMenu} onClose={() => setShowMicrophoneMenu(false)}>
      <MicrophoneSettings mode={listenModeSelection === 'pending' ? 'intelligent' : listenModeSelection} supported={isSpeechRecognitionSupported}
        engine={recognitionEngine} onEngineChange={(next) => { void handleSelectRecognitionEngine(next); }}
        onModeChange={(mode) => {
          if (mode === listenModeSelection) return;
          preparationRunRef.current += 1; setSpeakerConfirmed(false); setMicrophoneCalibrated(false);
          stopRehearsalSpeech(); stopSongAudio(); disposeCalibrationAudio(); stopRecognition(); void releaseListening();
          setIsPaused(false); setHasConfirmedRehearsalSetup(false); setRehearsalPreflightPhase(null);
          handleSelectListenMode(mode);
        }} onRepeatPreparation={() => {
          preparationRunRef.current += 1;
          stopRehearsalSpeech(); stopSongAudio(); disposeCalibrationAudio(); stopRecognition(); void releaseListening();
          setSpeakerConfirmed(false); setMicrophoneCalibrated(false);
          setAutoListenEnabled(false); setIsPreparingRehearsalMedia(false); setHasPreparedRehearsalMedia(false);
          setHasCompletedRehearsalPreflight(false); setIsRehearsalMediaReady(false);
          setHasConfirmedRehearsalSetup(false); setRehearsalPreflightPhase(null); setRehearsalMediaStatus(null);
          setIsPaused(false); setShowMicrophoneMenu(false);
        }} showTranscript={showTranscript} onTranscriptChange={(visible) => {
          setShowTranscript(visible);
          void AsyncStorage.setItem(REHEARSAL_TRANSCRIPT_STORAGE_KEY, String(visible)).catch(() => setPreferenceNotice('No se pudo recordar este ajuste. Sigue activo durante este ensayo.'));
        }} />
      {!spokenOnly ? <><Text style={ui.label}>AUDIO DE LAS CANCIONES</Text><View style={ui.wrap}><Chip label="Karaoke" selected={rehearsalAudioModeSelection === 'karaoke'} onPress={() => handleSelectRehearsalAudioMode('karaoke')} /><Chip label="Con voz" selected={rehearsalAudioModeSelection === 'vocal_guide'} onPress={() => handleSelectRehearsalAudioMode('vocal_guide')} /></View></> : null}
      <Button label={showDiagnostics ? 'Ocultar detalles de reconocimiento' : 'Ver detalles de reconocimiento'} secondary onPress={() => { setShowDiagnostics(!showDiagnostics); setShowMicrophoneMenu(false); }} />
      {renderIntelligentFeedbackBar()}
      {compatibilityMessage ? <Text style={ui.text}>{compatibilityMessage}</Text> : null}
      {preferenceNotice ? <Text style={ui.error}>{preferenceNotice}</Text> : null}
      <Button label="Listo" onPress={() => setShowMicrophoneMenu(false)} />
    </Sheet>
  </>;

  const renderIntelligentFeedbackBar = () => {
    if (
      !intelligentFeedbackEntries.length && !canReportCurrentLine && !feedbackStatusMessage
    ) {
      return null;
    }

    return (
      <View style={styles.intelligentFeedbackBar}>
        <View style={styles.intelligentFeedbackBarTextBlock}>
          <Text style={styles.intelligentFeedbackBarTitle}>
            Informe del ensayo{intelligentFeedbackEntries.length ? ` · ${intelligentFeedbackEntries.length} réplica${intelligentFeedbackEntries.length === 1 ? '' : 's'}` : ''}
          </Text>
          <Text accessibilityLiveRegion="polite" style={styles.intelligentFeedbackBarText}>
            {feedbackStatusMessage || 'Puedes enviarlo sin terminar las escenas. Incluye la réplica actual aunque esté incompleta.'}
          </Text>
        </View>
        {intelligentFeedbackEntries.length > 0 || canReportCurrentLine ? (
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.intelligentFeedbackBarButton, isSendingFeedback && styles.buttonDisabled]}
            onPress={() => void handleSendIntelligentFeedback()}
            disabled={isSendingFeedback}
          >
            <Text style={styles.intelligentFeedbackBarButtonText}>
              {isSendingFeedback ? 'Enviando informe...' : 'Enviar informe'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const shouldShowInitialSetup =
    !hasConfirmedRehearsalSetup ||
    listenModeSelection === 'pending' ||
    rehearsalAudioModeSelection === 'pending';
  const handleStartConfiguredRehearsal = useCallback(() => {
    if (listenModeSelection === 'pending' || rehearsalAudioModeSelection === 'pending') return;
    const preparation = rehearsalPreparationSession.getSnapshot();
    const step = getRehearsalPreparationStep(listenModeSelection, preparation);
    preparationRunRef.current += 1;
    setHasConfirmedRehearsalSetup(true); setSpeakerConfirmed(preparation.speakerConfirmed);
    setMicrophoneCalibrated(Boolean(preparation.calibration));
    if (preparation.calibration) applyMicrophoneCalibration(preparation.calibration);
    setHasCompletedRehearsalPreflight(false); setHasPreparedRehearsalMedia(false);
    setIsRehearsalMediaReady(false); setAutoListenEnabled(false); setCompatibilityMessage(null);
    stopRecognition();
    // Unlock song playback in this gesture even when no audible test is needed.
    if (!spokenOnly && step === 'ready') void primeSongPlayback();
    if (step === 'microphone') void calibrateRehearsalMicrophone();
    else if (step === 'speaker') prepareRehearsalMedia();
    else if (step === 'recognition') enableIntelligentListenForDevice();
    else finishRehearsalPreparation();
  }, [applyMicrophoneCalibration, calibrateRehearsalMicrophone, enableIntelligentListenForDevice,
    finishRehearsalPreparation, listenModeSelection, prepareRehearsalMedia, primeSongPlayback,
    rehearsalAudioModeSelection, spokenOnly, stopRecognition]);

  if (isExitingRehearsal) {
    return <View style={styles.container}>
      {renderHeader('Terminando ensayo')}
      <View style={styles.intro}><Text style={ui.subtitle}>Cerrando la escucha…</Text></View>
    </View>;
  }

  if (shouldShowInitialSetup) {
    return <View style={styles.container}>
      {renderHeader('Listo para ensayar')}
      <ScrollView contentContainerStyle={[ui.page, { paddingTop: 40 }]}>
        <Text style={ui.label}>TU ENSAYO</Text>
        <Text style={ui.title}>{initialIndex > 0 ? 'Seguimos donde lo dejaste' : 'Vamos a escena'}</Text>
        <Text style={ui.text}>{myRoles.join(', ')} · {filterScenes.length} {filterScenes.length === 1 ? 'escena' : 'escenas'}</Text>
        <View style={ui.card}><Icon name={listenModeSelection === 'manual' ? 'gesture-tap' : 'microphone-outline'} size={32} /><Text style={ui.subtitle}>{recognitionEngine === 'comparison' && isIntelligentListenMode ? 'Comparativa en el ensayo' : listenModeSelection === 'intelligent' ? 'Modo inteligente' : listenModeSelection === 'auto' ? 'Avance al terminar de hablar' : 'Modo manual'}</Text><Text style={ui.text}>{recognitionEngine === 'comparison' && isIntelligentListenMode ? 'Ensaya las escenas una sola vez. Guardaremos las tres transcripciones de cada réplica y sus puntuaciones, sin exigir un mínimo para pasar a la siguiente.' : listenModeSelection === 'intelligent' ? 'La app interpreta los demás personajes y comprueba tus palabras cuando llega tu turno.' : listenModeSelection === 'auto' ? 'Prepararemos el micro para avanzar cuando termines tu réplica y guardes silencio.' : 'La app interpreta los demás personajes. Pulsa siguiente al terminar tu réplica.'}</Text></View>
        <Text style={ui.text}>Las pruebas de audio se hacen una sola vez mientras la app siga abierta. Puedes repetirlas desde «Micrófono y voz».</Text>
        <Text style={ui.text}>En iPhone, desactiva Silencio (campana tachada) en el Centro de control. La música puede sonar aunque la voz esté silenciada.</Text>
        {isLocalSpeechRecognition && isIntelligentListenMode ? <Text style={ui.text}>{recognitionEngine === 'comparison'
          ? 'Safari, Vosk y Whisper escucharán en paralelo. En Comparativa, dos segundos sin voz cierran la toma. Los errores de un motor también quedarán guardados en el informe.' : usesWhisperRecognition(recognitionEngine)
          ? `Whisper usará el contexto del guion (${recognitionContext.names.length} nombres y ${recognitionContext.vocabulary.length} palabras). La primera preparación descarga el modelo y sus bibliotecas, hasta unos 100 MB con aceleración gráfica. Tus pausas no hacen avanzar la réplica.`
          : 'La escucha inteligente se prepara en este dispositivo. La primera vez descarga unos 40 MB; después reutiliza el modelo. Tus pausas no hacen avanzar la réplica.'}</Text> : null}
        <Button label={preferencesLoaded ? (initialIndex > 0 ? 'Continuar ensayo' : 'Empezar ensayo') : 'Recuperando preferencias…'} disabled={!preferencesLoaded} onPress={() => { setIsPaused(false); handleStartConfiguredRehearsal(); }} />
        <Button label="Micrófono y voz" secondary onPress={() => setShowMicrophoneMenu(true)} />
      </ScrollView>
    </View>;
  }

  const renderRecognitionError = (onRetry: () => void, retryLabel: string) => speechRecognitionError ? (
    <SpeechRecognitionErrorPanel error={speechRecognitionError}
      errorCode={speechRecognitionErrorCode} errorDetail={speechRecognitionErrorDetail}
      onRetry={onRetry} retryLabel={retryLabel} />
  ) : null;

  if (isCheckingIntelligentRecognition) {
    return <View style={styles.container}>
      {renderHeader('Preparando reconocimiento de voz')}
      <ScrollView contentContainerStyle={styles.preflightScrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.preflightCard}>
          {speechRecognitionStatus !== 'error' ? <>
            <Text style={styles.preflightTitle}>{usesWhisperRecognition(recognitionEngine)
              ? speechRecognitionStatus === 'processing' ? 'Comprobando la frase…' : isRecognitionAudioActive ? 'Micrófono listo' : hasSubmittedWhisperCheck ? 'Repite solo esta prueba' : 'Preparando Whisper…'
              : isRecognitionAudioActive ? 'Di «prueba de micro»' : isLocalSpeechRecognition ? 'Preparando la escucha en este dispositivo…' : 'Abriendo la escucha…'}</Text>
            <Text style={styles.preflightText}>
              {rehearsalPreparationSession.hasConfirmedRecognitionEngine(usesWhisperRecognition(recognitionEngine) ? 'whisper' : isLocalSpeechRecognition ? 'vosk' : 'native')
                ? 'Estamos activando el micrófono para este ensayo. Las pruebas de audio ya están hechas.'
                : usesWhisperRecognition(recognitionEngine)
                  ? speechRecognitionStatus === 'processing' ? 'La grabación ha terminado. Espera mientras Whisper comprueba la frase.'
                    : hasSubmittedWhisperCheck ? 'Whisper no ha reconocido la frase de prueba. Puedes repetirla conservando el altavoz y la calibración.'
                      : 'Espera a «Micrófono listo». Di una vez: «Hola, esta es una prueba de micro para empezar el ensayo». Después pulsa «Terminar y comprobar».'
                : isLocalSpeechRecognition
                  ? 'Permite el micrófono. La primera preparación descarga unos 40 MB. Después di «prueba de micro»: comprobaremos tus palabras antes de empezar.'
                  : 'Si Safari solicita reconocer tu voz, pulsa Permitir. Di «prueba de micro»: comprobaremos que aparecen tus palabras antes de entrar al ensayo.'}
            </Text>
            {!usesWhisperRecognition(recognitionEngine) || hasSubmittedWhisperCheck && speechRecognitionStatus !== 'processing'
              ? <Text style={styles.preflightText}>He oído: {speechRecognitionTranscript || (usesWhisperRecognition(recognitionEngine) ? 'No hemos recibido palabras.' : 'Esperando tus palabras…')}</Text> : null}
            {usesWhisperRecognition(recognitionEngine) && !hasSubmittedWhisperCheck ? <Button
              label="Terminar y comprobar" disabled={!isRecognitionAudioActive}
              onPress={() => { if (finishRecognitionInput()) setHasSubmittedWhisperCheck(true); }} /> : null}
            {usesWhisperRecognition(recognitionEngine) && hasSubmittedWhisperCheck && speechRecognitionStatus !== 'processing' ? <Button
              label="Reintentar prueba" onPress={enableIntelligentListenForDevice} /> : null}
          </> : null}
          {renderRecognitionError(enableIntelligentListenForDevice, usesWhisperRecognition(recognitionEngine) ? 'Reintentar prueba' : 'Reintentar inicio')}
          <TouchableOpacity accessibilityRole="button"
            style={[styles.preflightActionButton, styles.preflightFallbackButton]}
            onPress={() => {
              stopRecognition();
              setHasConfirmedRehearsalSetup(false);
              setRehearsalPreflightPhase(null);
            }}>
            <Text style={styles.preflightFallbackText}>Cambiar modo de ensayo</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>;
  }

  const renderCurrentAudioPanel = () => {
    if (!currentLine || !shouldShowCurrentAudioOptions) {
      return null;
    }

    return (
      <View style={styles.songAudioList}>
        <Text style={styles.songSectionTitle}>
          {currentMusicalNumber ? `Numero musical: ${currentMusicalNumber.title}` : 'Audios disponibles'}
        </Text>
        {currentMusicalNumber ? (
          <Text style={styles.songHint}>
            El audio seguira sonando entre el inicio y el final del numero musical, bajando volumen en el dialogo.
          </Text>
        ) : null}
        {shouldAskForRehearsalAudioChoice ? (
          <View style={styles.audioChoiceNotice}>
            <Text style={styles.audioChoiceNoticeTitle}>Elige el audio para este ensayo</Text>
            <Text style={styles.audioChoiceNoticeText}>
              Hay varias pistas que encajan igual con tus personajes. Guardare tu eleccion para no volver a preguntarte.
            </Text>
          </View>
        ) : selectedCurrentRehearsalAudioId ? (
          <Text style={styles.audioChoiceSavedText}>
            Audio elegido guardado. Puedes cambiarlo eligiendo otra pista.
          </Text>
        ) : null}
        {blockedAutoplayAudio ? (
          <View style={styles.songActivationCard}>
            <Text style={styles.songActivationText}>
              Safari ha bloqueado el arranque automatico de este {currentAudioModeLabel}.
            </Text>
            <TouchableOpacity
              style={styles.songActivationButton}
              onPress={() =>
                handlePlaySongAudio(blockedAutoplayAudio.audioUrl, blockedAutoplayAudio.audioId, {
                  advanceOnEnd: blockedAutoplayAudio.advanceOnEnd,
                  playbackKind: blockedAutoplayAudio.playbackKind,
                  ownerId: blockedAutoplayAudio.ownerId,
                  rememberForSelectionKey: blockedAutoplayAudio.selectionKey,
                  timelineCues: blockedAutoplayAudio.timelineCues,
                })
              }
            >
              <Text style={styles.songActivationButtonText}>Activar audio y reproducir</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {currentRehearsalAudioOptions.map((audio) => {
          const isPlaying = playingAudioId === audio.id;
          const isSelected = selectedCurrentRehearsalAudioId === audio.id;
          const isChoiceCandidate = currentRehearsalAudioChoiceCandidates.some(
            (candidate) => candidate.id === audio.id
          );
          const buttonLabel = isPlaying
            ? 'Detener'
            : isSelected
              ? 'Reproducir'
              : selectedCurrentRehearsalAudioId
                ? 'Cambiar'
                : 'Elegir';

          return (
            <View
              key={audio.id}
              style={[
                styles.songAudioCard,
                isChoiceCandidate && shouldAskForRehearsalAudioChoice && styles.songAudioCardChoice,
                isSelected && styles.songAudioCardSelected,
              ]}
            >
              <View style={styles.songAudioText}>
                <Text style={styles.songAudioTitle}>{audio.label}</Text>
                <Text style={styles.songAudioMeta}>
                  {formatSongAudioKind(audio.kind)}
                  {audio.guideRoles.length > 0 ? ` · ${audio.guideRoles.join(', ')}` : ''}
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.songAudioButton,
                  isSelected && !isPlaying && styles.songAudioButtonSelected,
                  isPlaying && styles.songAudioButtonActive,
                ]}
                onPress={() =>
                  handlePlaySongAudio(audio.audioUrl, audio.id, {
                    advanceOnEnd: currentMusicalNumber ? false : true,
                    playbackKind: currentMusicalNumber ? 'musical-number' : 'song',
                    ownerId: currentMusicalNumber?.id ?? currentSongAsset?.id ?? null,
                    rememberForSelectionKey: currentRehearsalAudioSelectionKey,
                    timelineCues: currentMusicalNumber ? audio.timelineCues ?? [] : [],
                  })
                }
              >
                <Text style={styles.songAudioButtonText}>{buttonLabel}</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    );
  };

  const renderIntelligentLinePanel = () => {
    if (!isMyTurn || listenModeSelection !== 'intelligent') {
      return null;
    }
    if (recognitionEngine === 'comparison') return <View style={styles.intelligentPanel}>
      <Text style={styles.intelligentLabel}>{isPaused ? 'Comparativa en pausa' : comparison.message || 'Preparando comparativa…'}</Text>
      {comparison.results.map(item => <View key={item.engine} style={{ gap: 3, marginTop: 10 }}>
        <Text style={[ui.label, { color: palette.ink }]}>{item.engine === 'native' ? 'SAFARI' : item.engine.toUpperCase()} · {Math.round(scoreLineMatch(speakableLineText, item.text).score * 100)} %</Text>
        {showTranscript ? <Text style={[ui.text, { color: palette.ink }]}>{item.text || 'Esperando palabras…'}</Text> : null}
        {item.error ? <Text style={ui.error}>{item.error}</Text> : null}
      </View>)}
      <Text style={[ui.text, { color: palette.ink, marginTop: 10 }]}>Di la réplica una sola vez. Dos segundos sin voz cierran la toma. Pasaremos cuando terminen los motores, aunque la coincidencia sea 0 %.</Text>
      <Button label="Terminar réplica" secondary disabled={isPaused || !pageVisible || comparison.phase !== 'listening'} onPress={() => finishComparison('button')} />
      {comparison.phase === 'error' ? <Button label="Reintentar comparativa" secondary onPress={comparison.restart} /> : null}
      {feedbackStatusMessage ? <Text style={styles.intelligentFeedbackStatus}>{feedbackStatusMessage}</Text> : null}
    </View>;

    const hasTranscript = speechRecognitionTranscript.trim().length > 0;
    const canRejectAutoAdvance =
      pendingInvalidAutoAdvance?.lineIndex === currentLineIndexInScript;
    const scorePercent = Math.round(intelligentLineMatch.score * 100);
    const finalPhrasePercent = Math.round(intelligentLineMatch.finalPhraseScore * 100);
    const automaticReason = getAutomaticLineMatchReason(
      speakableLineText,
      speechRecognitionTranscript,
      intelligentLineMatch
    );
    const canRepeatWhisperLine = usesWhisperRecognition(recognitionEngine) && hasTranscript &&
      getAutomaticLineAdvanceDelay(speakableLineText, speechRecognitionTranscript,
        speechRecognitionInterimTranscript, intelligentLineMatch) === null;
    const scoreToneStyle =
      automaticReason || intelligentLineMatch.score >= 0.88
        ? styles.intelligentScoreGood
        : intelligentLineMatch.score >= 0.65
          ? styles.intelligentScoreWarning
          : styles.intelligentScoreLow;

    return (
      <View style={styles.intelligentPanel}>
        <Text style={styles.intelligentLabel}>
          {isPaused ? 'Ensayo en pausa' : !pageVisible || speechRecognitionStatus === 'suspended'
            ? 'Ensayo en espera. La escucha se recuperará al volver a esta pestaña.'
            : speechRecognitionStatus === 'error'
            ? 'La escucha necesita tu atención'
            : speechRecognitionStatus === 'preparing' || speechRecognitionStatus === 'finishing'
              ? 'Preparando la escucha…'
            : isRecognitionAudioActive
              ? hasRecognitionReceivedText ? 'Estoy recibiendo tus palabras.' : 'Micrófono abierto. Esperando tus palabras…'
              : speechRecognitionStatus === 'starting'
                ? 'Abriendo el micrófono…'
                : 'Esperando la entrada del micrófono'}
        </Text>
        {renderRecognitionError(handleRetryIntelligentLine, 'Activar micrófono')}
        {showTranscript ? <View testID="rehearsal-transcript" style={{ gap: 6, marginTop: 10 }}>
          <Text style={ui.label}>HE OÍDO</Text>
          <Text style={[ui.text, { color: palette.ink }]}>{speechRecognitionTranscript || 'Tu transcripción aparecerá aquí…'}</Text>
        </View> : null}
        {canRepeatWhisperLine ? <Button label="Repetir réplica" secondary disabled={isPaused || !pageVisible}
          onPress={handleRetryIntelligentLine} /> : null}
        {showDiagnostics ? <>
        <Text style={styles.intelligentTitle}>Laboratorio de linea</Text>
        <Text style={styles.intelligentHint}>
          Avanzamos si la coincidencia supera {Math.round(INTELLIGENT_AUTO_ADVANCE_THRESHOLD * 100)}% o si el cierre
          de la replica encaja bien. El detalle queda guardado para repasar despues.
          Tambien puedes decir Linea buena para aceptar la replica por voz.
        </Text>
        <View style={styles.intelligentScoreRow}>
          <Text style={styles.intelligentLabel}>Coincidencia</Text>
          <Text style={[styles.intelligentScore, scoreToneStyle]}>{scorePercent}%</Text>
        </View>
        <Text style={styles.intelligentMetaText}>
          Estado: {speechRecognitionStatus} - Idioma: {intelligentRecognitionLanguage}
          {currentAcceptedLineVariants.length > 0
            ? ` - ${currentAcceptedLineVariants.length} variante${currentAcceptedLineVariants.length === 1 ? '' : 's'}`
            : ''}
        </Text>
        {hasTranscript ? (
          <Text style={styles.intelligentMetaText}>
            Cierre de replica: {finalPhrasePercent}%
            {automaticReason ? ` - Avance: ${automaticReason.replace(/_/g, ' ')}` : ''}
          </Text>
        ) : null}
        {feedbackStatusMessage ? (
          <Text style={styles.intelligentFeedbackStatus}>{feedbackStatusMessage}</Text>
        ) : null}
        {canRejectAutoAdvance ? (
          <View style={styles.intelligentFalsePositiveBlock}>
            <Text style={styles.intelligentFalsePositiveText}>
              Has vuelto tras un autoavance. Dinos que paso para ajustar las reglas.
            </Text>
            <View style={styles.intelligentIssueOptions}>
              {INTELLIGENT_FALSE_POSITIVE_ISSUES.map((issue) => {
                const isSelected = falsePositiveIssueType === issue.type;

                return (
                  <TouchableOpacity
                    key={issue.type}
                    style={[
                      styles.intelligentIssueButton,
                      isSelected && styles.intelligentIssueButtonSelected,
                    ]}
                    onPress={() => setFalsePositiveIssueType(issue.type)}
                  >
                    <Text
                      style={[
                        styles.intelligentIssueButtonText,
                        isSelected && styles.intelligentIssueButtonTextSelected,
                      ]}
                    >
                      {issue.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={styles.intelligentIssueHint}>
              {
                INTELLIGENT_FALSE_POSITIVE_ISSUES.find(
                  (issue) => issue.type === falsePositiveIssueType
                )?.hint
              }
            </Text>
            {falsePositiveIssueType === 'otro' ? (
              <TextInput
                style={styles.intelligentIssueInput}
                value={falsePositiveIssueNote}
                onChangeText={setFalsePositiveIssueNote}
                placeholder="Que crees que ha pasado?"
                placeholderTextColor="#9a6a33"
                multiline
              />
            ) : null}
            <TouchableOpacity
              style={[styles.intelligentButton, styles.intelligentFalsePositiveButton]}
              onPress={handleRejectLastAutoAdvance}
            >
              <Text style={styles.intelligentButtonText}>Guardar incidencia</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <View style={styles.intelligentActions}>
          <TouchableOpacity
            style={[styles.intelligentButton, styles.intelligentGoodButton, !hasTranscript && styles.buttonDisabled]}
            onPress={() => void handleAcceptIntelligentLine()}
            disabled={!hasTranscript}
          >
            <Text style={styles.intelligentButtonText}>Linea buena</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.intelligentButton, styles.intelligentSkipButton]}
            onPress={handleSkipIntelligentLine}
          >
            <Text style={styles.intelligentButtonText}>Siguiente linea</Text>
          </TouchableOpacity>
        </View>
        </> : null}
      </View>
    );
  };

  if (!isRehearsalMediaReady) {
    const isCalibrating = rehearsalPreflightPhase === 'micro-calibration';
    const isReadyToCalibrate = rehearsalPreflightPhase === 'ready-to-calibrate';
    const isReadyToListen = rehearsalPreflightPhase === 'ready-to-listen';
    const isReadyToStart = rehearsalPreflightPhase === 'ready-to-start';
    return <View style={styles.container}>
      {renderHeader(listenModeSelection === 'manual' ? 'Preparar altavoz' : 'Preparar audio y micrófono')}
      <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
        <View style={ui.wrap}>{[`${speakerConfirmed ? '✓' : '1'} Altavoz`, ...(listenModeSelection === 'manual' ? [] : [`${microphoneCalibrated ? '✓' : '2'} Micro`]), `${listenModeSelection === 'manual' ? '2' : '3'} Ensayo`].map((label) => <View key={label} style={[ui.chip, { backgroundColor: palette.soft }]}><Text style={[ui.chipText, { color: palette.plum }]}>{label}</Text></View>)}</View>
        <View style={ui.card}>
          <Icon name={isCalibrating || isReadyToCalibrate || isReadyToListen ? 'microphone-outline' : 'volume-high'} size={34} />
          <Text style={ui.title}>{isCalibrating || isReadyToCalibrate ? 'Calibrar micrófono' : isReadyToListen ? 'Activar la escucha' : isReadyToStart ? 'Todo preparado' : '¿Oyes a la app?'}</Text>
          {!speakerConfirmed ? <Text style={ui.text}>En iPhone, desactiva Silencio (campana tachada) en el Centro de control. La música puede sonar aunque la voz esté silenciada. Después repite la prueba de voz.</Text> : null}
          <Text style={ui.text}>{isCalibrating ? 'Guarda silencio. Después del pitido, di «prueba de micro». Esperaremos a que empieces a hablar.' : isReadyToCalibrate ? 'Ya has comprobado la voz de la app. Ahora mediremos el ruido de fondo y tu voz.' : isReadyToListen ? 'La calibración ya está hecha. Ahora comprobaremos que el reconocimiento transcribe tus palabras.' : isReadyToStart ? listenModeSelection === 'manual' ? 'El altavoz está preparado. Ensayarás sin activar el micrófono.' : 'El altavoz y el micrófono ya están comprobados.' : 'Sube el volumen y escucha la frase. No entraremos al ensayo hasta que confirmes que la oyes.'}</Text>
          {rehearsalMediaStatus ? <Text accessibilityLiveRegion="polite" style={[ui.text, { color: palette.plum }]}>{rehearsalMediaStatus}</Text> : null}
          {isCalibrating ? <>
            <View style={styles.microCalibrationMeterTrack}><View style={[styles.microCalibrationMeterFill, { width: `${Math.max(4, Math.round(signalLevel * 100))}%`, backgroundColor: palette.plum }]} /></View>
            <Text style={ui.text}>Nivel de entrada: {Math.round(rawLevel * 100)}% · {Math.round(microphoneCalibrationProgress * 100)}%</Text>
            {listeningError ? <Text style={ui.error}>{listeningError}</Text> : null}
            <Button label={isPreparingRehearsalMedia ? 'Calibrando…' : 'Reintentar calibración'} disabled={isPreparingRehearsalMedia} onPress={() => void calibrateRehearsalMicrophone()} />
          </> : isReadyToCalibrate ? <Button label="Calibrar micrófono" onPress={() => void calibrateRehearsalMicrophone()} />
            : isReadyToListen ? <Button label="Comprobar escucha" onPress={enableIntelligentListenForDevice} />
            : isReadyToStart ? <Button label="Empezar ensayo" onPress={() => finishRehearsalPreparation()} />
            : <>
              <Button label={isPreparingRehearsalMedia ? 'Reproduciendo prueba…' : hasPreparedRehearsalMedia ? 'Repetir prueba de voz' : 'Probar voz'} disabled={isPreparingRehearsalMedia} secondary onPress={prepareRehearsalMedia} />
              {hasPreparedRehearsalMedia ? <Button label="Sí, la oigo. Continuar" onPress={() => {
                  rehearsalPreparationSession.confirmSpeaker(); setSpeakerConfirmed(true);
                  const needsCalibration = listenModeSelection !== 'manual' && !rehearsalPreparationSession.getSnapshot().calibration;
                  setRehearsalPreflightPhase(needsCalibration ? 'ready-to-calibrate' : listenModeSelection === 'intelligent' ? 'ready-to-listen' : 'ready-to-start');
                  setRehearsalMediaStatus(null);
              }} /> : null}
            </>}
        </View>
        <Button label="Micrófono y voz" secondary disabled={isPreparingRehearsalMedia} onPress={() => setShowMicrophoneMenu(true)} />
      </ScrollView>
    </View>;
  }

  if (isSceneMarker(currentLine)) {
    return (
      <View style={styles.container}>
        {renderHeader('Cambio de escena')}
        <View style={styles.intro}>
          <Text style={styles.introTitle}>Escena: {currentLine.t}</Text>
          <Text style={ui.text}>{listenModeSelection === 'manual' || !isSpeechRecognitionSupported
            ? 'Pulsa «Siguiente escena» cuando quieras empezar.'
            : 'Di «adelante» o pulsa «Siguiente escena» cuando quieras empezar.'}</Text>
          {sceneAnnouncementError ? <Text style={ui.error}>{sceneAnnouncementError}</Text> : null}
          {shouldListenForSceneCommand && isSpeechRecognitionSupported ? <>
            <Text accessibilityLiveRegion="polite" style={ui.text}>{isRecognitionAudioActive
              ? 'Escuchando «adelante»…' : 'Preparando la escucha…'}</Text>
            {renderRecognitionError(restartRecognition, 'Activar micrófono')}
          </> : null}
          <Button label="Siguiente escena" onPress={startCurrentScene} />
        </View>
      </View>
    );
  }

  if (isSongCue(currentLine)) {
    return (
      <View style={styles.container}>
        {renderHeader('Cancion dentro de la escena')}

        <ScrollView contentContainerStyle={styles.center}>
          <View style={styles.songBox}>
            <Text style={styles.songBadge}>Cancion</Text>
            <Text style={styles.songTitle}>{currentLine.songTitle || 'Cancion'}</Text>
            {currentLine.a ? <Text style={[styles.acot, { color: '#66512b' }]}>[{currentLine.a}]</Text> : null}

            {shouldShowCurrentAudioOptions ? (
              renderCurrentAudioPanel()
            ) : currentRehearsalAudioOptions.length ? (
              <View style={styles.songAudioList}>
                <Text style={styles.songSectionTitle}>Audios disponibles</Text>
                {blockedAutoplayAudio ? (
                  <View style={styles.songActivationCard}>
                    <Text style={styles.songActivationText}>
                      Safari ha bloqueado el arranque automatico de esta cancion.
                    </Text>
                    <TouchableOpacity
                      style={styles.songActivationButton}
                      onPress={() =>
                        handlePlaySongAudio(blockedAutoplayAudio.audioUrl, blockedAutoplayAudio.audioId, {
                          advanceOnEnd: blockedAutoplayAudio.advanceOnEnd,
                          playbackKind: blockedAutoplayAudio.playbackKind,
                          ownerId: blockedAutoplayAudio.ownerId,
                          rememberForSelectionKey: currentRehearsalAudioSelectionKey,
                          timelineCues: blockedAutoplayAudio.timelineCues,
                        })
                      }
                    >
                      <Text style={styles.songActivationButtonText}>Activar audio y reproducir</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                {currentRehearsalAudioOptions.map((audio) => {
                  const isPlaying = playingAudioId === audio.id;

                  return (
                    <View key={audio.id} style={styles.songAudioCard}>
                      <View style={styles.songAudioText}>
                        <Text style={styles.songAudioTitle}>{audio.label}</Text>
                        <Text style={styles.songAudioMeta}>
                          {formatSongAudioKind(audio.kind)}
                          {audio.guideRoles.length > 0 ? ` · ${audio.guideRoles.join(', ')}` : ''}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.songAudioButton, isPlaying && styles.songAudioButtonActive]}
                        onPress={() =>
                          handlePlaySongAudio(audio.audioUrl, audio.id, {
                            advanceOnEnd: currentMusicalNumber ? false : true,
                            playbackKind: currentMusicalNumber ? 'musical-number' : 'song',
                            ownerId: currentMusicalNumber?.id ?? currentSongAsset?.id ?? null,
                            rememberForSelectionKey: currentRehearsalAudioSelectionKey,
                            timelineCues: currentMusicalNumber ? audio.timelineCues ?? [] : [],
                          })
                        }
                      >
                        <Text style={styles.songAudioButtonText}>{isPlaying ? 'Detener' : 'Reproducir'}</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.songHint}>Todavia no hay audios cargados para esta cancion.</Text>
            )}

            {audioError ? <Text style={styles.songErrorText}>{audioError}</Text> : null}
            <Text style={styles.songText}>{currentLine.t}</Text>
            <Text style={styles.songHint}>
              {currentMusicalNumber
                ? 'Este bloque forma parte de un numero musical. Si activas su audio, seguira vivo durante el dialogo intermedio.'
                : currentSongAsset?.audios.length === 1
                  ? 'La cancion se reproduce automaticamente y al terminar pasa a la linea siguiente.'
                  : 'La voz se pausa aqui para que podais seguir la letra manualmente.'}
            </Text>
          </View>
        </ScrollView>

        <TouchableOpacity style={[styles.footer, styles.songFooter]} onPress={advanceLine}>
          <Text style={styles.btnText}>Continuar tras la cancion</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {renderHeader(`${Math.min(currentIndex + 1, filteredGuion.length)} / ${filteredGuion.length} · Ensayo`)}

      <ScrollView contentContainerStyle={styles.center}>
        {isFinished ? (
          <View style={styles.finishedBox}>
            <Text style={styles.finishedTitle}>Fin del ensayo</Text>
            {feedbackStatusMessage ? (
              <Text style={styles.intelligentFeedbackStatus}>{feedbackStatusMessage}</Text>
            ) : null}
            <TouchableOpacity onPress={handleExit} style={styles.btnBack}>
              <Text style={styles.btnText}>Volver al inicio</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.box, isMyTurn && styles.myBox]}>
            {currentIndex > 0 && !isSceneMarker(filteredGuion[currentIndex - 1]) ? <View style={{ gap: 5, marginBottom: 24, alignSelf: 'stretch' }}><Text style={[ui.label, { color: palette.sub }]}>{filteredGuion[currentIndex - 1].p} · ANTES</Text><Text numberOfLines={3} style={ui.text}>{filteredGuion[currentIndex - 1].t}</Text></View> : null}
            <Text style={ui.label}>{isMyTurn ? 'TU TURNO' : 'ESCUCHA'}</Text>
            <Text style={[styles.name, isMyTurn && styles.myName]}>{currentLine?.p}</Text>
            {currentLine?.a ? <Text style={styles.acot}>[{currentLine.a}]</Text> : null}
            <Text style={[styles.text, isMyTurn && styles.myText]}>{currentLine?.t}</Text>
            {isMyTurn && (
              <Text style={styles.myTurnHint}>
                {listenModeSelection === 'intelligent'
                  ? 'Habla con naturalidad. Avanzaremos al completar tu réplica.'
                  : listenModeSelection === 'manual'
                    ? 'Tu turno: interpreta tu réplica y pulsa siguiente cuando termines.'
                    : 'Tu turno: lee y guardaremos silencio para pasar solos, o pulsa siguiente si lo prefieres.'}
              </Text>
            )}
            {isMyTurn && listeningStatus === 'error' && listeningError ? (
              <Text style={styles.listenError}>{listeningError}</Text>
            ) : null}
            {isMyTurn && autoListenEnabled && showDiagnostics ? (
              <View style={styles.listenMonitor}>
                <Text style={styles.listenHint}>
                  {isListeningActive
                    ? 'El micro esta abierto en esta replica: cuando termines y guardes silencio, pasaremos solos.'
                    : 'La escucha esta activada para el ensayo y abriremos el micro automaticamente al entrar en tu replica.'}
                </Text>
                <View style={styles.listenMeterTrack}>
                  <View
                    style={[
                      styles.listenMeterFill,
                      {
                        width: `${Math.max(6, Math.round(signalLevel * 100))}%`,
                        backgroundColor: isSignalAboveThreshold ? '#2b9348' : '#d98a00',
                      },
                    ]}
                  />
                </View>
                <Text style={styles.listenDebugText}>
                  Nivel micro: {Math.round(signalLevel * 100)}% · Estado:{' '}
                  {lineStateLabel}
                </Text>
                <Text style={styles.listenDebugText}>
                  Silencio acumulado: {(silenceElapsedMs / 1000).toFixed(1)} s
                </Text>
                <Text style={styles.listenDebugText}>
                  Umbral de voz: {(voiceThreshold * 100).toFixed(1)}%
                </Text>
                <Text style={styles.listenDebugText}>
                  Voz confirmada: {hasSpeechStarted ? 'si' : 'no'} · Sobre umbral:{' '}
                  {isSignalAboveThreshold ? 'si' : 'no'}
                </Text>
              </View>
            ) : null}
            {renderIntelligentLinePanel()}
            {!isMyTurn && speechStatusMessage && showDiagnostics ? (
              <View style={styles.speechMonitor}>
                <Text style={styles.speechMonitorText}>{speechStatusMessage}</Text>
                {autoListenEnabled ? (
                  <TouchableOpacity
                    style={styles.speechFallbackButton}
                    onPress={() =>
                      void disableAutoListenForDevice(
                        'Hemos desactivado la escucha automatica en este dispositivo porque has indicado que la voz del resto no se escucha bien.'
                      )
                    }
                  >
                    <Text style={styles.speechFallbackButtonText}>No se escucha la voz</Text>
                  </TouchableOpacity>
                ) : null}
                <Text style={styles.speechMonitorTextSmall}>
                  Estado micro: {listeningStatus} · Escucha automatica: si
                </Text>
              </View>
            ) : null}
            {currentMusicalNumber ? renderCurrentAudioPanel() : null}
          </View>
        )}
      </ScrollView>

      {!isFinished ? <View style={[ui.header, { justifyContent: 'space-between', borderTopWidth: 1, borderBottomWidth: 0, backgroundColor: palette.surface }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Línea anterior" disabled={!canGoBack} onPress={goBackLine} style={[ui.icon, !canGoBack && { opacity: 0.3 }]}><Icon name="skip-previous" size={28} /></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={isPaused ? 'Reanudar ensayo' : 'Pausar ensayo'} onPress={() => {
          if (isPaused) {
            if (listenModeSelection === 'intelligent' && recognitionEngine !== 'comparison' && isMyTurn && !isCurrentMusicalSongBlock && !isSceneMarker(currentLine)) {
              activateRecognition({ lang: recognitionEngine === 'vosk' ? 'es-ES' : intelligentRecognitionLanguage, lineKey: recognitionLineKey || recognitionPreparationKey, preserveTranscript: true });
            }
            setIsPaused(false);
          } else {
            setIsPaused(true); stopRehearsalSpeech(); stopStandaloneSongAudio(); stopRecognition(); void releaseListening();
          }
        }} style={[ui.button, ui.row, { minWidth: 140 }]}><Icon name={isPaused ? 'play' : 'pause'} color="#fff" /><Text style={ui.buttonText}>{isPaused ? 'Reanudar' : 'Pausa'}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Siguiente línea" onPress={isIntelligentListenMode && isMyTurn ? handleSkipIntelligentLine : advanceLine} style={ui.icon}><Icon name="skip-next" size={28} /></TouchableOpacity>
      </View> : null}
    </View>
  );
};

const createStyles = (palette: PracticePalette) => StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingTop: 60,
    padding: 20,
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: '#eee',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerActions: {
    gap: 8,
  },
  headerStatus: {
    alignItems: 'flex-end',
    gap: 4,
    maxWidth: '58%',
  },
  headerStatusTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  blue: { color: '#007AFF', fontWeight: 'bold' },
  backLink: { color: '#007AFF', fontWeight: '600' },
  backLinkDisabled: { color: '#9fb9d3' },
  listenLink: { color: '#8a5a00', fontWeight: '700' },
  listenLinkActive: { color: '#2b9348' },
  listenLinkResettable: { color: '#c96b00', textDecorationLine: 'underline' },
  sceneName: { fontSize: 12, color: '#666' },
  listenStatus: { fontSize: 12, color: '#2b9348', fontWeight: '600' },
  compatibilityDot: {
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: '#d62828',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compatibilityDotText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 12,
  },
  compatibilityPopover: {
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(214, 40, 40, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(214, 40, 40, 0.18)',
    maxWidth: 240,
  },
  compatibilityPopoverText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#7a1f1f',
    textAlign: 'right',
  },
  intelligentFeedbackBar: {
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#eefcff',
    borderWidth: 1,
    borderColor: palette.rule,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  intelligentFeedbackBarTextBlock: {
    flex: 1,
    gap: 2,
  },
  intelligentFeedbackBarTitle: {
    color: '#15515b',
    fontWeight: '900',
    fontSize: 13,
  },
  intelligentFeedbackBarText: {
    color: '#47604f',
    fontSize: 12,
    lineHeight: 17,
  },
  intelligentFeedbackBarButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#15515b',
  },
  intelligentFeedbackBarButtonText: {
    color: '#fff',
    fontWeight: '800',
  },
  center: { flexGrow: 1, justifyContent: 'center', padding: 22 },
  intro: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  introTitle: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 30, color: palette.ink },
  preflightScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  preflightCard: {
    width: '100%',
    maxWidth: 540,
    padding: 24,
    borderRadius: 20,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: '#d7e6f5',
    gap: 16,
  },
  preflightTitle: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    color: palette.ink,
  },
  preflightText: {
    textAlign: 'center',
    lineHeight: 22,
    color: palette.sub,
  },
  preflightStatus: {
    textAlign: 'center',
    lineHeight: 22,
    color: '#1e6091',
    fontWeight: '600',
  },
  preflightStatusSecondary: {
    textAlign: 'center',
    lineHeight: 22,
    color: '#7a4d00',
    fontWeight: '600',
  },
  preflightSectionTitle: {
    marginTop: 6,
    textAlign: 'center',
    color: '#17324c',
    fontWeight: '800',
    fontSize: 16,
  },
  preflightActions: {
    gap: 10,
    marginTop: 4,
  },
  preflightActionButton: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  preflightConfirmButton: {
    backgroundColor: 'rgba(43, 147, 72, 0.84)',
    borderColor: 'rgba(43, 147, 72, 0.95)',
  },
  preflightMusicKaraokeButton: {
    backgroundColor: 'rgba(165, 37, 88, 0.9)',
    borderColor: 'rgba(165, 37, 88, 0.96)',
  },
  preflightMusicGuideButton: {
    backgroundColor: 'rgba(91, 63, 140, 0.9)',
    borderColor: 'rgba(91, 63, 140, 0.96)',
  },
  preflightIntelligentButton: {
    backgroundColor: 'rgba(34, 126, 140, 0.92)',
    borderColor: 'rgba(34, 126, 140, 0.98)',
  },
  preflightManualButton: {
    backgroundColor: '#f5ede3',
    borderColor: '#e4d1b3',
  },
  preflightUnselectedButton: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderColor: '#d7e6f5',
  },
  preflightFallbackButton: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderColor: '#f1c8c8',
  },
  preflightConfirmText: {
    color: '#fff',
    fontWeight: '700',
  },
  preflightFallbackText: {
    color: '#c62828',
    fontWeight: '700',
  },
  preflightManualText: {
    color: '#6f4c19',
    fontWeight: '700',
  },
  preflightUnselectedButtonText: {
    color: '#17324c',
  },
  preflightSteps: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  preflightStep: {
    flex: 1,
    alignItems: 'center',
    padding: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: '#d7e6f5',
  },
  preflightStepBadge: {
    minWidth: 42,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#eef4fb',
    alignItems: 'center',
    marginBottom: 6,
  },
  preflightStepBadgeDone: {
    backgroundColor: '#2b9348',
  },
  preflightStepBadgeActive: {
    backgroundColor: '#1e6091',
  },
  preflightStepBadgeSkipped: {
    backgroundColor: '#8a6d3b',
  },
  preflightStepBadgeText: {
    color: '#17324c',
    fontSize: 11,
    fontWeight: '800',
  },
  preflightStepBadgeTextActive: {
    color: '#fff',
  },
  preflightStepTitle: {
    color: '#17324c',
    fontWeight: '800',
    textAlign: 'center',
  },
  preflightStepDetail: {
    color: '#5a6f82',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
    textAlign: 'center',
  },
  microCalibrationBox: {
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(247, 251, 255, 0.94)',
    borderWidth: 1,
    borderColor: '#c9def0',
    gap: 8,
  },
  microCalibrationMeterTrack: {
    height: 12,
    borderRadius: 999,
    backgroundColor: '#dce8f0',
    overflow: 'hidden',
  },
  microCalibrationMeterFill: {
    height: '100%',
    minWidth: 8,
    borderRadius: 999,
  },
  microCalibrationText: {
    textAlign: 'center',
    color: '#17324c',
    fontWeight: '700',
  },
  microCalibrationTextSmall: {
    textAlign: 'center',
    color: '#47604f',
    fontSize: 12,
    lineHeight: 18,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  finishedBox: { alignItems: 'center' },
  finishedTitle: { fontSize: 20, fontWeight: 'bold', color: palette.ink },
  box: { paddingVertical: 24, gap: 8, alignItems: 'flex-start' },
  songBox: {
    padding: 28,
    borderRadius: 20,
    backgroundColor: '#fff7e8',
    borderWidth: 1,
    borderColor: '#f1d18a',
    width: '100%',
  },
  songBadge: {
    alignSelf: 'center',
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f0b84a',
    color: '#5f3a00',
    fontWeight: '700',
  },
  songTitle: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 14,
    color: '#5f3a00',
  },
  songText: {
    fontSize: 22,
    textAlign: 'center',
    lineHeight: 34,
    color: '#4d3b16',
  },
  songHint: {
    marginTop: 20,
    textAlign: 'center',
    color: '#7a6332',
    fontSize: 14,
  },
  songSectionTitle: {
    marginTop: 0,
    marginBottom: 10,
    textAlign: 'center',
    color: '#5f3a00',
    fontWeight: '800',
  },
  songAudioList: {
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#fff7e8',
  },
  audioChoiceNotice: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(240, 184, 74, 0.18)',
    borderWidth: 1,
    borderColor: '#d9a43c',
    gap: 6,
  },
  audioChoiceNoticeTitle: {
    color: '#5f3a00',
    fontWeight: '800',
    textAlign: 'center',
  },
  audioChoiceNoticeText: {
    color: '#7a6332',
    lineHeight: 20,
    textAlign: 'center',
  },
  audioChoiceSavedText: {
    color: '#5f3a00',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  songActivationCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(95, 58, 0, 0.08)',
    borderWidth: 1,
    borderColor: '#d3b26f',
    gap: 10,
  },
  songActivationText: {
    textAlign: 'center',
    color: '#5f3a00',
    lineHeight: 20,
  },
  songActivationButton: {
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#b06d00',
  },
  songActivationButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  songAudioCard: {
    marginTop: 4,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: '#f0ddb4',
    gap: 12,
  },
  songAudioCardChoice: {
    borderColor: '#d9a43c',
    backgroundColor: 'rgba(255, 249, 236, 0.94)',
  },
  songAudioCardSelected: {
    borderColor: '#2b9348',
    backgroundColor: 'rgba(238, 252, 241, 0.94)',
  },
  songAudioText: {
    gap: 4,
  },
  songAudioTitle: {
    fontWeight: '700',
    color: '#5f3a00',
    textAlign: 'center',
  },
  songAudioMeta: {
    textAlign: 'center',
    color: '#7a6332',
    lineHeight: 20,
  },
  songAudioButton: {
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#5f3a00',
  },
  songAudioButtonActive: {
    backgroundColor: '#9c2f24',
  },
  songAudioButtonSelected: {
    backgroundColor: '#2b9348',
  },
  songAudioButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  songErrorText: {
    marginTop: 12,
    color: '#b3261e',
    textAlign: 'center',
    lineHeight: 20,
  },
  myBox: { backgroundColor: 'transparent' },
  name: { fontSize: 16, fontWeight: '700', marginTop: 12, marginBottom: 8, color: palette.sub },
  myName: { color: palette.plum },
  acot: { fontStyle: 'italic', color: palette.sub, marginBottom: 15 },
  text: { fontSize: 30, textAlign: 'left', lineHeight: 41, color: palette.ink },
  myText: { color: palette.ink, fontWeight: '600' },
  myTurnHint: { marginTop: 14, fontSize: 14, lineHeight: 22, color: palette.sub },
  listenHint: {
    marginTop: 12,
    fontSize: 14,
    color: '#4f6274',
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 20,
  },
  listenError: {
    marginTop: 12,
    fontSize: 14,
    color: '#b3261e',
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
  },
  listenMonitor: {
    marginTop: 12,
    width: '100%',
    gap: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1,
    borderColor: '#d7e6f5',
  },
  listenMeterTrack: {
    width: '100%',
    height: 12,
    borderRadius: 999,
    backgroundColor: '#dfe8ef',
    overflow: 'hidden',
  },
  listenMeterFill: {
    height: '100%',
    borderRadius: 999,
  },
  listenDebugText: {
    fontSize: 13,
    color: '#47604f',
    textAlign: 'center',
    lineHeight: 18,
  },
  intelligentPanel: {
    marginTop: 14,
    width: '100%',
    padding: 14,
    borderRadius: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.rule,
    gap: 10,
  },
  intelligentTitle: {
    color: palette.plum,
    fontWeight: '900',
    fontSize: 16,
    textAlign: 'center',
  },
  intelligentHint: {
    color: palette.sub,
    lineHeight: 19,
    textAlign: 'center',
    fontSize: 13,
  },
  intelligentTranscriptBlock: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: palette.soft,
    borderWidth: 1,
    borderColor: '#d5edf2',
    gap: 4,
  },
  intelligentLabel: {
    color: palette.plum,
    fontWeight: '800',
    textTransform: 'uppercase',
    fontSize: 11,
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  intelligentExpectedText: {
    color: palette.ink,
    lineHeight: 22,
    textAlign: 'center',
  },
  intelligentHeardText: {
    color: palette.ink,
    lineHeight: 22,
    textAlign: 'center',
    fontWeight: '600',
  },
  intelligentInterimText: {
    color: palette.sub,
    lineHeight: 18,
    textAlign: 'center',
    fontSize: 12,
  },
  intelligentScoreRow: {
    alignItems: 'center',
    gap: 2,
  },
  intelligentScore: {
    fontSize: 28,
    fontWeight: '900',
  },
  intelligentScoreGood: {
    color: palette.green,
  },
  intelligentScoreWarning: {
    color: palette.plum,
  },
  intelligentScoreLow: {
    color: palette.error,
  },
  intelligentMetaText: {
    color: palette.sub,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  intelligentFeedbackStatus: {
    color: palette.plum,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 18,
  },
  intelligentFalsePositiveBlock: {
    gap: 8,
    padding: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 245, 232, 0.95)',
    borderWidth: 1,
    borderColor: '#e8b66f',
  },
  intelligentFalsePositiveText: {
    color: '#6b3f00',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'center',
  },
  intelligentIssueOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  intelligentIssueButton: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: '#d6a763',
  },
  intelligentIssueButtonSelected: {
    backgroundColor: '#8a5a00',
    borderColor: '#6d4500',
  },
  intelligentIssueButtonText: {
    color: '#7a4a00',
    fontSize: 12,
    fontWeight: '800',
  },
  intelligentIssueButtonTextSelected: {
    color: '#fff',
  },
  intelligentIssueHint: {
    color: '#6b3f00',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
    textAlign: 'center',
  },
  intelligentIssueInput: {
    minHeight: 70,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d6a763',
    backgroundColor: 'rgba(255,255,255,0.94)',
    color: '#4a2e00',
    textAlignVertical: 'top',
  },
  intelligentActions: {
    gap: 8,
  },
  intelligentButton: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  intelligentGoodButton: {
    backgroundColor: '#2b9348',
    borderColor: '#24783b',
  },
  intelligentRetryButton: {
    backgroundColor: '#fff',
    borderColor: '#d8b36a',
  },
  intelligentSkipButton: {
    backgroundColor: '#1e6091',
    borderColor: '#174b73',
  },
  intelligentFalsePositiveButton: {
    backgroundColor: '#b3261e',
    borderColor: '#8e1f19',
  },
  intelligentButtonText: {
    color: '#fff',
    fontWeight: '800',
  },
  intelligentRetryText: {
    color: '#8a5a00',
    fontWeight: '800',
  },
  speechMonitor: {
    marginTop: 14,
    width: '100%',
    padding: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(235, 244, 255, 0.92)',
    borderWidth: 1,
    borderColor: '#d4e3f3',
    gap: 6,
  },
  speechMonitorText: {
    color: '#22476b',
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: 20,
  },
  speechMonitorTextSmall: {
    color: '#4f6274',
    textAlign: 'center',
    fontSize: 12,
    lineHeight: 18,
  },
  speechFallbackButton: {
    alignSelf: 'center',
    marginTop: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#b06d00',
  },
  speechFallbackButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  footer: { backgroundColor: '#007AFF', padding: 25, alignItems: 'center' },
  footerActive: { backgroundColor: 'red' },
  songFooter: { backgroundColor: '#d98a00' },
  btnNext: { backgroundColor: '#007AFF', padding: 20, borderRadius: 15, width: '100%', alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  btnBack: { backgroundColor: '#333', padding: 15, borderRadius: 10, marginTop: 20 },
});
