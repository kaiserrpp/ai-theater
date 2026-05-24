import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { submitIntelligentLineFeedback } from '../api/sharedScripts';
import { useSilenceAdvance, type MicrophoneCalibrationSnapshot } from '../hooks/useSilenceAdvance';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import {
  INTELLIGENT_LINE_VARIANTS_STORAGE_PREFIX,
  LEGACY_REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY,
  REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY,
  REHEARSAL_AUDIO_MODE_STORAGE_KEY,
  REHEARSAL_LISTEN_MODE_STORAGE_KEY,
} from '../store/storageKeys';
import { Dialogue } from '../types/script';
import {
  MusicalTimelineCue,
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
  getAutomaticLineMatchReason,
  getGoodLineCommandAcceptedText,
  hashLineText,
  inferSpeechRecognitionLanguage,
  isSafeAutomaticLineMatch,
  isNextLineCommand,
  scoreLineMatch,
} from '../utils/lineMatching';
import { speakRehearsalSpeech, stopRehearsalSpeech } from '../utils/rehearsalSpeech';
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
  onProgressChange?: (lineIndex: number, totalLines: number) => void;
  onExit: () => void;
}

type RehearsalPreflightPhase =
  | 'auto-initial'
  | 'manual-check'
  | 'auto-final'
  | 'micro-calibration'
  | null;
type RehearsalListenModeSelection = 'pending' | 'auto' | 'manual' | 'intelligent';
type ConfirmedRehearsalListenMode = Exclude<RehearsalListenModeSelection, 'pending'>;
type RehearsalAudioModeSelection = 'pending' | SharedSongAudioKind;
type RehearsalSessionPreparation = {
  listenMode: ConfirmedRehearsalListenMode;
  audioMode: SharedSongAudioKind;
  preparedAt: string;
  microphoneCalibration?: MicrophoneCalibrationSnapshot;
};

type LineVariantMap = Record<string, string[]>;
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
const APP_LINE_ADVANCE_DELAY_MS = 220;
const USER_LINE_RESPONSE_BUFFER_MS = 550;
const APP_SPEECH_WORDS_PER_SECOND = 2.65;
const USER_SPEECH_WORDS_PER_SECOND = 2.35;
const REHEARSAL_SESSION_PREPARATION_PREFIX = 'teatro_ia_rehearsal_session_preparation:';

const isConfirmedListenMode = (value: unknown): value is ConfirmedRehearsalListenMode =>
  value === 'auto' || value === 'manual' || value === 'intelligent';

const isSharedSongAudioKind = (value: unknown): value is SharedSongAudioKind =>
  value === 'karaoke' || value === 'vocal_guide';

const getSafeSessionStorage = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const buildRehearsalSessionPreparationKey = (scriptId: string) =>
  `${REHEARSAL_SESSION_PREPARATION_PREFIX}${scriptId}`;

const isValidMicrophoneCalibration = (
  value: unknown
): value is MicrophoneCalibrationSnapshot => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<MicrophoneCalibrationSnapshot>;
  return (
    typeof candidate.noiseFloor === 'number' &&
    typeof candidate.voiceLevel === 'number' &&
    typeof candidate.voiceThreshold === 'number' &&
    Number.isFinite(candidate.noiseFloor) &&
    Number.isFinite(candidate.voiceLevel) &&
    Number.isFinite(candidate.voiceThreshold)
  );
};

const parseRehearsalSessionPreparation = (
  rawValue: string | null
): RehearsalSessionPreparation | null => {
  if (!rawValue) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(rawValue) as Partial<RehearsalSessionPreparation>;
    if (
      !isConfirmedListenMode(parsedValue.listenMode) ||
      !isSharedSongAudioKind(parsedValue.audioMode)
    ) {
      return null;
    }

    return {
      listenMode: parsedValue.listenMode,
      audioMode: parsedValue.audioMode,
      preparedAt:
        typeof parsedValue.preparedAt === 'string'
          ? parsedValue.preparedAt
          : new Date().toISOString(),
      microphoneCalibration: isValidMicrophoneCalibration(parsedValue.microphoneCalibration)
        ? parsedValue.microphoneCalibration
        : undefined,
    };
  } catch {
    return null;
  }
};

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

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });

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

const formatMicroLevel = (value: number) => `${(value * 100).toFixed(1)}%`;

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

  const getAudioRoleStats = (audio: SharedSongAudioAsset) => {
    const overlapCount = audio.guideRoles.filter((role) => myRoles.includes(role)).length;
    const outsideCount = audio.guideRoles.filter((role) => !myRoles.includes(role)).length;

    return {
      overlapCount,
      outsideCount,
      taggedCount: audio.guideRoles.length,
    };
  };

  const sortByRoleStats = (
    audioList: SharedSongAudioAsset[],
    mode: 'matching-vocal' | 'complement-vocal' | 'broad-vocal' | 'karaoke'
  ) =>
    [...audioList].sort((leftAudio, rightAudio) => {
      const leftStats = getAudioRoleStats(leftAudio);
      const rightStats = getAudioRoleStats(rightAudio);

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
    vocalGuideAudios.filter((audio) => getAudioRoleStats(audio).overlapCount > 0),
    'matching-vocal'
  );
  const complementaryVocalGuides = sortByRoleStats(
    vocalGuideAudios.filter((audio) => {
      const stats = getAudioRoleStats(audio);
      return stats.overlapCount === 0 && stats.outsideCount > 0;
    }),
    'complement-vocal'
  );
  const broadVocalGuides = sortByRoleStats(
    vocalGuideAudios.filter((audio) => getAudioRoleStats(audio).outsideCount > 0),
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
  onProgressChange,
  onExit,
}) => {
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
    useState<RehearsalListenModeSelection>('pending');
  const [rehearsalAudioModeSelection, setRehearsalAudioModeSelection] =
    useState<RehearsalAudioModeSelection>('pending');
  const [temporarilySuspendingAutoListen, setTemporarilySuspendingAutoListen] = useState(false);
  const [speechStatusMessage, setSpeechStatusMessage] = useState<string | null>(null);
  const [compatibilityMessage, setCompatibilityMessage] = useState<string | null>(null);
  const [showCompatibilityInfo, setShowCompatibilityInfo] = useState(false);
  const [isRehearsalMediaReady, setIsRehearsalMediaReady] = useState(false);
  const [isPreparingRehearsalMedia, setIsPreparingRehearsalMedia] = useState(false);
  const [rehearsalMediaStatus, setRehearsalMediaStatus] = useState<string | null>(null);
  const [hasPreparedRehearsalMedia, setHasPreparedRehearsalMedia] = useState(false);
  const [hasCompletedRehearsalPreflight, setHasCompletedRehearsalPreflight] = useState(false);
  const [rehearsalPreflightPhase, setRehearsalPreflightPhase] = useState<RehearsalPreflightPhase>(null);
  const [hasConfirmedRehearsalSetup, setHasConfirmedRehearsalSetup] = useState(false);
  const [hasSessionPreparedRehearsalMedia, setHasSessionPreparedRehearsalMedia] = useState(false);
  const [isSongPlaybackUnlocked, setIsSongPlaybackUnlocked] = useState(false);
  const [lineVariants, setLineVariants] = useState<LineVariantMap>({});
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
  const [blockedAutoplayAudio, setBlockedAutoplayAudio] = useState<{
    audioId: string;
    audioUrl: string;
    playbackKind?: 'song' | 'musical-number';
    ownerId?: string | null;
    advanceOnEnd?: boolean;
    timelineCues?: MusicalTimelineCue[];
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const songAudioContextRef = useRef<AudioContext | null>(null);
  const songAudioSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const songAudioGainRef = useRef<GainNode | null>(null);
  const desiredSongAudioVolumeRef = useRef(1);
  const hasSongAudioGainFailedRef = useRef(false);
  const autoStartedSongKeyRef = useRef<string | null>(null);
  const autoStartedMusicalNumberKeyRef = useRef<string | null>(null);
  const activeAudioPlaybackRef = useRef<{
    kind: 'song' | 'musical-number';
    ownerId: string | null;
    audioId: string | null;
    timelineCues: MusicalTimelineCue[];
    firedTimelineCueIds: Set<string>;
  } | null>(null);
  const selectedMusicalNumberAudioIdsRef = useRef<Record<string, string>>({});
  const intelligentSessionIdRef = useRef(createSessionId());
  const processedCommandLineKeyRef = useRef<string | null>(null);
  const processedGoodLineCommandKeyRef = useRef<string | null>(null);
  const processedAutoAdvanceLineKeyRef = useRef<string | null>(null);
  const activeIntelligentRecognitionLanguageRef = useRef('es-ES');
  const lastIntelligentAutoAdvanceRef = useRef<LastIntelligentAutoAdvance | null>(null);
  const rehearsalSessionPreparationKey = useMemo(
    () => buildRehearsalSessionPreparationKey(resolvedScriptId),
    [resolvedScriptId]
  );

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
  const preferredMusicalNumberAudio = useMemo<SharedSongAudioAsset | null>(() => {
    if (!currentMusicalNumber?.audios.length) {
      return null;
    }

    const rememberedAudioId = selectedMusicalNumberAudioIdsRef.current[currentMusicalNumber.id];
    return (
      getPreferredRehearsalAudios(
        currentMusicalNumber.audios,
        effectiveRehearsalAudioKind,
        myRoles,
        rememberedAudioId
      )[0] ?? null
    );
  }, [currentMusicalNumber, effectiveRehearsalAudioKind, myRoles]);
  const preferredSongAudio = useMemo<SharedSongAudioAsset | null>(() => {
    if (currentMusicalNumber || !currentSongAsset?.audios.length) {
      return null;
    }

    return (
      getPreferredRehearsalAudios(
        currentSongAsset.audios,
        effectiveRehearsalAudioKind,
        myRoles
      )[0] ?? null
    );
  }, [currentMusicalNumber, currentSongAsset, effectiveRehearsalAudioKind, myRoles]);
  const currentRehearsalAudioOptions = useMemo(
    () => {
      const baseAudios = currentMusicalNumber?.audios.length
        ? currentMusicalNumber.audios
        : currentSongAsset?.audios ?? [];
      const rememberedAudioId = currentMusicalNumber
        ? selectedMusicalNumberAudioIdsRef.current[currentMusicalNumber.id]
        : null;

      return getPreferredRehearsalAudios(
        baseAudios,
        effectiveRehearsalAudioKind,
        myRoles,
        rememberedAudioId
      );
    },
    [currentMusicalNumber, currentSongAsset, effectiveRehearsalAudioKind, myRoles]
  );
  const canStartRehearsalAudio =
    hasConfirmedRehearsalSetup &&
    isRehearsalMediaReady &&
    hasCompletedRehearsalPreflight &&
    !rehearsalPreflightPhase &&
    listenModeSelection !== 'pending' &&
    rehearsalAudioModeSelection !== 'pending';
  const currentSongKey = isSongCue(currentLine)
    ? `${currentIndex}:${currentSongAsset?.id ?? currentLine?.songTitle ?? 'song'}`
    : null;
  const currentMusicalNumberKey = currentMusicalNumber
    ? `${currentMusicalNumber.id}:${currentMusicalNumber.updatedAt}`
    : null;
  const currentDialogueKey =
    !isFinished && currentLine ? `${currentIndex}:${currentLine.p}:${currentLine.t}` : null;
  const currentLineVariantKey =
    !isFinished && currentLine && currentLineIndexInScript >= 0
      ? buildLineVariantKey(currentLineIndexInScript, currentLine.t)
      : null;
  const currentAcceptedLineVariants = useMemo(
    () => (currentLineVariantKey ? lineVariants[currentLineVariantKey] ?? [] : []),
    [currentLineVariantKey, lineVariants]
  );
  const intelligentRecognitionLanguage = inferSpeechRecognitionLanguage(speakableLineText);
  const isIntelligentListenMode = listenModeSelection === 'intelligent';
  const effectiveAutoListenEnabled = autoListenEnabled && !temporarilySuspendingAutoListen;
  const canRunRehearsalLinePlayback =
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
    !isSongCue(currentLine) &&
    isMyTurn &&
    speakableLineText.length > 0;
  const shouldUseIntelligentRecognition =
    canRunRehearsalLinePlayback &&
    isIntelligentListenMode &&
    !isFinished &&
    Boolean(currentLine) &&
    !isSceneMarker(currentLine) &&
    !isSongCue(currentLine) &&
    isMyTurn &&
    speakableLineText.length > 0;
  const shouldKeepIntelligentRecognitionWarm =
    shouldUseIntelligentRecognition ||
    (
      isMobileSpeechDevice &&
      isIntelligentListenMode &&
      canRunRehearsalLinePlayback &&
      !isFinished &&
      Boolean(currentLine)
    );
  if (shouldUseIntelligentRecognition) {
    activeIntelligentRecognitionLanguageRef.current = intelligentRecognitionLanguage;
  }
  const shouldKeepListeningWarmDuringSong =
    canRunRehearsalLinePlayback &&
    effectiveAutoListenEnabled &&
    Boolean(currentLine) &&
    isSongCue(currentLine);
  const recognitionLineKey =
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
    setCurrentIndex((previousIndex) =>
      previousIndex < filteredGuion.length ? previousIndex + 1 : previousIndex
    );
  }, [filteredGuion.length]);

  const {
    listeningStatus,
    listeningError,
    isListeningActive,
    isListeningSupported,
    signalLevel,
    rawLevel,
    hasSpeechStarted,
    isSignalAboveThreshold,
    silenceElapsedMs,
    voiceThreshold,
    microphoneCalibrationStatus,
    microphoneCalibrationProgress,
    microphoneNoiseFloor,
    microphoneVoiceLevel,
    lineStateLabel,
    calibrateAmbientNoise,
    calibrateVoiceLevel,
    applyMicrophoneCalibration,
    resetMicrophoneCalibration,
    startListening,
    stopListening,
    releaseListening,
  } = useSilenceAdvance({
    enabledForCurrentLine: shouldArmListeningForCurrentLine,
    lineKey: currentDialogueKey,
    onSilenceDetected: advanceLine,
  });

  const {
    isSupported: isSpeechRecognitionSupported,
    status: speechRecognitionStatus,
    transcript: speechRecognitionTranscript,
    interimTranscript: speechRecognitionInterimTranscript,
    error: speechRecognitionError,
    resetTranscript: resetSpeechRecognitionTranscript,
    restartRecognition,
    stopRecognition,
  } = useSpeechRecognition({
    enabled: shouldKeepIntelligentRecognitionWarm,
    lang: activeIntelligentRecognitionLanguageRef.current,
    lineKey: recognitionLineKey,
  });

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

  const readSessionPreparation = useCallback(() => {
    const sessionStorage = getSafeSessionStorage();
    return parseRehearsalSessionPreparation(
      sessionStorage?.getItem(rehearsalSessionPreparationKey) ?? null
    );
  }, [rehearsalSessionPreparationKey]);

  const clearSessionPreparation = useCallback(() => {
    getSafeSessionStorage()?.removeItem(rehearsalSessionPreparationKey);
    setHasSessionPreparedRehearsalMedia(false);
  }, [rehearsalSessionPreparationKey]);

  const markSessionPreparationReady = useCallback((
    listenModeOverride?: RehearsalListenModeSelection,
    audioModeOverride?: RehearsalAudioModeSelection,
    microphoneCalibrationOverride?: MicrophoneCalibrationSnapshot
  ) => {
    const confirmedListenMode = listenModeOverride ?? listenModeSelection;
    const confirmedAudioMode = audioModeOverride ?? rehearsalAudioModeSelection;

    if (
      !isConfirmedListenMode(confirmedListenMode) ||
      !isSharedSongAudioKind(confirmedAudioMode)
    ) {
      return;
    }

    const sessionStorage = getSafeSessionStorage();
    if (!sessionStorage) {
      return;
    }

    const sessionPreparation: RehearsalSessionPreparation = {
      listenMode: confirmedListenMode,
      audioMode: confirmedAudioMode,
      preparedAt: new Date().toISOString(),
    };

    const calibrationSnapshot =
      microphoneCalibrationOverride ??
      ((microphoneCalibrationStatus === 'ready' || microphoneCalibrationStatus === 'weak')
        ? {
            status: microphoneCalibrationStatus,
            noiseFloor: microphoneNoiseFloor,
            voiceLevel: microphoneVoiceLevel,
            voiceThreshold,
          }
        : null);

    if (confirmedListenMode !== 'manual' && calibrationSnapshot) {
      sessionPreparation.microphoneCalibration = calibrationSnapshot;
    }

    sessionStorage.setItem(
      rehearsalSessionPreparationKey,
      JSON.stringify(sessionPreparation)
    );
    setHasSessionPreparedRehearsalMedia(true);
  }, [
    listenModeSelection,
    microphoneCalibrationStatus,
    microphoneNoiseFloor,
    microphoneVoiceLevel,
    rehearsalAudioModeSelection,
    rehearsalSessionPreparationKey,
    voiceThreshold,
  ]);

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

  const recordIntelligentFeedback = useCallback(
    (result: IntelligentLineFeedbackResult, heardTextOverride?: string) => {
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
    recordIntelligentFeedback('reintentar');
    setFeedbackStatusMessage('Resultado guardado. Reintentamos esta linea.');
    restartRecognition();
  }, [recordIntelligentFeedback, restartRecognition]);

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
    if (!intelligentFeedbackEntries.length || isSendingFeedback) {
      return;
    }

    setIsSendingFeedback(true);
    setFeedbackStatusMessage('Enviando informe de prueba...');

    try {
      const result = await submitIntelligentLineFeedback({
        sessionId: intelligentSessionIdRef.current,
        scriptId: resolvedScriptId,
        shareId,
        scriptTitle,
        appVersion: Constants.expoConfig?.version ?? 'dev',
        userRoles: myRoles,
        userAgent: getUserAgent(),
        entries: intelligentFeedbackEntries,
      });

      setIntelligentFeedbackEntries([]);
      setFeedbackStatusMessage(`Informe enviado (${result.entryCount} lineas).`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo enviar el informe de prueba.';
      setFeedbackStatusMessage(message);
    } finally {
      setIsSendingFeedback(false);
    }
  }, [
    intelligentFeedbackEntries,
    isSendingFeedback,
    myRoles,
    resolvedScriptId,
    scriptTitle,
    shareId,
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
    const hasBlockingInterimTranscript =
      speechRecognitionInterimTranscript.trim() && intelligentLineMatch.score < 0.95;

    if (
      !shouldUseIntelligentRecognition ||
      !currentLineVariantKey ||
      !currentLine ||
      currentLineIndexInScript < 0 ||
      hasBlockingInterimTranscript ||
      !speechRecognitionTranscript.trim() ||
      !isSafeAutomaticLineMatch(speakableLineText, speechRecognitionTranscript, intelligentLineMatch)
    ) {
      return;
    }

    const autoAdvanceKey = `${currentLineVariantKey}:${speechRecognitionTranscript}:${intelligentLineMatch.referenceIndex}`;
    if (processedAutoAdvanceLineKeyRef.current === autoAdvanceKey) {
      return;
    }

    const autoAdvanceTimeout = setTimeout(() => {
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
    }, 90);

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
      setShowCompatibilityInfo(false);
      await releaseListening();

      try {
        await AsyncStorage.setItem(REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY, storedValue);
      } catch (error) {
        console.error('Error guardando compatibilidad de audio', error);
      }
    },
    [releaseListening]
  );

  const enableAutoListenForDevice = useCallback(async () => {
    setListenModeSelection('auto');
    setAutoListenEnabled(true);
    setTemporarilySuspendingAutoListen(false);
    setIsRehearsalMediaReady(false);
    setIsPreparingRehearsalMedia(false);
    setHasPreparedRehearsalMedia(false);
    setHasCompletedRehearsalPreflight(false);
    setRehearsalPreflightPhase('auto-initial');
    setRehearsalMediaStatus('Antes de empezar, vamos a preparar micro y voz.');
    setCompatibilityMessage(null);
    setShowCompatibilityInfo(false);

    try {
      await Promise.all([
        AsyncStorage.removeItem(REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY),
        AsyncStorage.removeItem(LEGACY_REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY),
      ]);
    } catch (error) {
      console.error('Error reseteando compatibilidad de audio', error);
    }
  }, []);

  const enableIntelligentListenForDevice = useCallback(async () => {
    setListenModeSelection('intelligent');
    setAutoListenEnabled(true);
    setTemporarilySuspendingAutoListen(false);
    setIsRehearsalMediaReady(false);
    setIsPreparingRehearsalMedia(false);
    setHasPreparedRehearsalMedia(false);
    setHasCompletedRehearsalPreflight(false);
    setRehearsalPreflightPhase('auto-initial');
    setRehearsalMediaStatus('Antes de empezar, vamos a preparar audio y micro.');
    setCompatibilityMessage(null);
    setShowCompatibilityInfo(false);
  }, []);

  useEffect(() => {
    if (!isListeningSupported && listenModeSelection !== 'intelligent') {
      setListenModeSelection('manual');
      setIsRehearsalMediaReady(true);
      setIsPreparingRehearsalMedia(false);
      setHasPreparedRehearsalMedia(false);
      setHasCompletedRehearsalPreflight(true);
      setRehearsalPreflightPhase(null);
      setRehearsalMediaStatus(null);
      return;
    }

    if (!hasConfirmedRehearsalSetup || listenModeSelection === 'pending') {
      setIsRehearsalMediaReady(false);
      setIsPreparingRehearsalMedia(false);
      setHasPreparedRehearsalMedia(false);
      setHasCompletedRehearsalPreflight(false);
      setRehearsalPreflightPhase(null);
      setRehearsalMediaStatus(null);
      return;
    }

    if (!autoListenEnabled && rehearsalPreflightPhase !== 'manual-check') {
      setIsRehearsalMediaReady(true);
      setIsPreparingRehearsalMedia(false);
      setHasPreparedRehearsalMedia(false);
      setHasCompletedRehearsalPreflight(true);
      setRehearsalPreflightPhase(null);
      setRehearsalMediaStatus(null);
      return;
    }

    if (hasCompletedRehearsalPreflight) {
      setIsRehearsalMediaReady(true);
      setIsPreparingRehearsalMedia(false);
      setHasPreparedRehearsalMedia(false);
      return;
    }

    setIsRehearsalMediaReady(false);
    setIsPreparingRehearsalMedia(false);
    setHasPreparedRehearsalMedia(false);
    if (!rehearsalPreflightPhase) {
      setRehearsalPreflightPhase('auto-initial');
    }
    setRehearsalMediaStatus((previousStatus) => previousStatus ?? 'Antes de empezar, vamos a preparar micro y voz.');
  }, [
    autoListenEnabled,
    hasCompletedRehearsalPreflight,
    hasConfirmedRehearsalSetup,
    isListeningSupported,
    listenModeSelection,
    rehearsalPreflightPhase,
  ]);

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

    if (songAudioContextRef.current && songAudioGainRef.current) {
      return {
        context: songAudioContextRef.current,
        gainNode: songAudioGainRef.current,
      };
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
      player.pause();
      player.currentTime = 0;
      player.onended = null;
      player.onerror = null;
      player.muted = true;
      player.src = silentObjectUrl;
      player.load();
      await prepareSongAudioOutput();
      await player.play();
      player.pause();
      player.currentTime = 0;
      player.removeAttribute('src');
      player.load();
      player.muted = false;
      setIsSongPlaybackUnlocked(true);
      return true;
    } catch {
      player.muted = false;
      return false;
    } finally {
      URL.revokeObjectURL(silentObjectUrl);
    }
  }, [getSongAudioPlayer, prepareSongAudioOutput]);

  const restorePreparedRehearsalSession = useCallback(async () => {
    if (
      !isConfirmedListenMode(listenModeSelection) ||
      !isSharedSongAudioKind(rehearsalAudioModeSelection)
    ) {
      return false;
    }

    const storedPreparation = readSessionPreparation();
    if (!storedPreparation) {
      setHasSessionPreparedRehearsalMedia(false);
      return false;
    }

    if (listenModeSelection !== 'manual') {
      if (!storedPreparation.microphoneCalibration) {
        setHasSessionPreparedRehearsalMedia(false);
        return false;
      }

      applyMicrophoneCalibration(storedPreparation.microphoneCalibration);
    }

    void primeSongPlayback();
    setHasConfirmedRehearsalSetup(true);
    setAutoListenEnabled(listenModeSelection === 'auto');
    setTemporarilySuspendingAutoListen(false);
    setIsRehearsalMediaReady(true);
    setIsPreparingRehearsalMedia(false);
    setHasPreparedRehearsalMedia(false);
    setHasCompletedRehearsalPreflight(true);
    setRehearsalPreflightPhase(null);
    setRehearsalMediaStatus(null);
    setCompatibilityMessage(null);
    setShowCompatibilityInfo(false);
    setHasSessionPreparedRehearsalMedia(true);

    if (listenModeSelection !== 'auto') {
      await releaseListening();
    }

    if (listenModeSelection !== 'intelligent') {
      void stopRecognition();
    }

    return true;
  }, [
    applyMicrophoneCalibration,
    listenModeSelection,
    primeSongPlayback,
    readSessionPreparation,
    rehearsalAudioModeSelection,
    releaseListening,
    stopRecognition,
  ]);

  const playMicroCalibrationBeep = useCallback(async () => {
    const player = getSongAudioPlayer();
    const toneObjectUrl = createMicroCalibrationToneObjectUrl();

    if (!player || !toneObjectUrl) {
      await wait(320);
      return;
    }

    await new Promise<void>((resolve) => {
      let isResolved = false;

      const finish = () => {
        if (isResolved) {
          return;
        }
        isResolved = true;
        player.onended = null;
        player.onerror = null;
        URL.revokeObjectURL(toneObjectUrl);
        resolve();
      };

      player.pause();
      player.currentTime = 0;
      player.src = toneObjectUrl;
      player.onended = finish;
      player.onerror = finish;
      void player.play().catch(finish);
      setTimeout(finish, 900);
    });
  }, [getSongAudioPlayer]);

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
        const [storedListenMode, storedAudioMode] = await Promise.all([
          AsyncStorage.getItem(REHEARSAL_LISTEN_MODE_STORAGE_KEY),
          AsyncStorage.getItem(REHEARSAL_AUDIO_MODE_STORAGE_KEY),
        ]);

        if (!isMounted) {
          return;
        }

        if (
          isConfirmedListenMode(storedListenMode) &&
          (storedListenMode !== 'intelligent' || isSpeechRecognitionSupported)
        ) {
          setListenModeSelection(storedListenMode);
        }

        if (isSharedSongAudioKind(storedAudioMode)) {
          setRehearsalAudioModeSelection(storedAudioMode);
        }
      } catch (error) {
        console.error('Error cargando preferencias de ensayo', error);
      }
    };

    void loadRehearsalPreferences();

    return () => {
      isMounted = false;
    };
  }, [isSpeechRecognitionSupported]);

  useEffect(() => {
    setHasSessionPreparedRehearsalMedia(Boolean(readSessionPreparation()));
  }, [readSessionPreparation]);

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
        void startListening();
      }
      return;
    }

    if (shouldKeepListeningWarmDuringSong) {
      return;
    }

    if (isListeningActive) {
      void stopListening();
    }
  }, [
    effectiveAutoListenEnabled,
    isListeningActive,
    listeningStatus,
    rehearsalPreflightPhase,
    shouldKeepListeningWarmDuringSong,
    shouldArmListeningForCurrentLine,
    startListening,
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
    if (!canRunRehearsalLinePlayback) {
      return;
    }

    stopRehearsalSpeech();
    stopStandaloneSongAudio();
    let isCancelled = false;
    let advanceTimeout: ReturnType<typeof setTimeout> | null = null;
    let speechStartTimeout: ReturnType<typeof setTimeout> | null = null;

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

    const playOtherLine = async () => {
      if (temporarilySuspendingAutoListen) {
        await stopListening();
        if (isCancelled) {
          return;
        }
      }

      const speechDelayMs = temporarilySuspendingAutoListen ? 0 : autoListenEnabled ? 120 : 0;
      setSpeechStatusMessage(
        temporarilySuspendingAutoListen || autoListenEnabled
          ? 'Micro liberado. Preparando la voz de Siri para la siguiente linea...'
          : 'Preparando la voz de Siri para la siguiente linea...'
      );

      speechStartTimeout = setTimeout(() => {
        setSpeechStatusMessage('Lanzando la linea con Siri...');
        const speechRate = getAdaptiveRehearsalSpeechRate();
        speakRehearsalSpeech(speakableLineText, {
          rate: speechRate,
          onStart: () => {
            if (isCancelled) {
              return;
            }
            setSpeechStatusMessage('Reproduciendo la linea con Siri...');
          },
          onDone: () => {
            if (isCancelled) {
              return;
            }
            setSpeechStatusMessage('Linea reproducida. Avanzando...');
            advanceTimeout = setTimeout(advanceLine, APP_LINE_ADVANCE_DELAY_MS);
          },
          onError: (error) => {
            if (isCancelled) {
              return;
            }
            setSpeechStatusMessage(
              `Siri ha fallado al reproducir esta linea (${error.message}).`
            );
          },
        });
      }, speechDelayMs);
    };

    void playOtherLine();

    return () => {
      isCancelled = true;
      if (advanceTimeout) {
        clearTimeout(advanceTimeout);
      }
      if (speechStartTimeout) {
        clearTimeout(speechStartTimeout);
      }
      void stopListening();
      stopRehearsalSpeech();
      stopStandaloneSongAudio();
    };
  }, [
    advanceLine,
    autoListenEnabled,
    canRunRehearsalLinePlayback,
    currentLine,
    temporarilySuspendingAutoListen,
    isFinished,
    isListeningActive,
    listeningStatus,
    isMyTurn,
    getAdaptiveRehearsalSpeechRate,
    speakableLineText,
    stopListening,
    stopStandaloneSongAudio,
  ]);

  useEffect(() => () => {
    disposeSongAudio();
  }, [disposeSongAudio]);

  const handleExit = () => {
    stopRehearsalSpeech();
    disposeSongAudio();
    stopRecognition();
    void releaseListening();
    onExit();
  };

  const currentAudioModeLabel = currentMusicalNumber ? 'numero musical' : 'cancion';
  const shouldShowCurrentAudioOptions = currentRehearsalAudioOptions.length > 0;

  const prepareRehearsalMedia = useCallback(async (phase = rehearsalPreflightPhase ?? 'auto-initial') => {
    const shouldUseAutoListen = phase !== 'manual-check';
    stopRehearsalSpeech();
    stopStandaloneSongAudio();
    const primeSongPlaybackPromise = primeSongPlayback();
    setIsPreparingRehearsalMedia(true);
    setHasPreparedRehearsalMedia(false);
    setHasCompletedRehearsalPreflight(false);
    setRehearsalPreflightPhase(phase);
    setAutoListenEnabled(shouldUseAutoListen);
    setTemporarilySuspendingAutoListen(false);

    if (phase === 'manual-check') {
      setRehearsalMediaStatus('Ahora va a sonar otra prueba.');
    } else if (phase === 'auto-final') {
      setRehearsalMediaStatus('Ultima prueba de audio.');
    } else {
      setRehearsalMediaStatus('Ahora va a sonar un mensaje.');
    }

    try {
      if (shouldUseAutoListen) {
        await startListening();
        await wait(450);
        setRehearsalMediaStatus('Pausamos el micro para escuchar la prueba.');
        await stopListening();
        await wait(220);
      } else {
        await wait(120);
      }

      setRehearsalMediaStatus('Escucha a la app.');

      await new Promise<void>((resolve) => {
        let isResolved = false;

        speakRehearsalSpeech('Hola, hola, dime si me oyes.', {
          onStart: () => {
            setRehearsalMediaStatus('Sonando...');
          },
          onDone: () => {
            if (isResolved) {
              return;
            }
            isResolved = true;
            resolve();
          },
          onError: () => {
            if (isResolved) {
              return;
            }
            isResolved = true;
            resolve();
          },
        });

        setTimeout(() => {
          if (isResolved) {
            return;
          }
          isResolved = true;
          resolve();
        }, 2600);
      });

      await primeSongPlaybackPromise;
      setHasPreparedRehearsalMedia(true);
      setRehearsalMediaStatus(
        phase === 'manual-check'
          ? 'Si ahora has oido la frase, volveremos a activar el micro y haremos una comprobacion final.'
          : phase === 'auto-final'
            ? 'Has oido a la app?'
            : 'Has oido a la app?'
      );
    } catch {
      setRehearsalMediaStatus('No se pudo reproducir la prueba. Puedes volver a intentarlo.');
    } finally {
      setIsPreparingRehearsalMedia(false);
    }
  }, [
    primeSongPlayback,
    rehearsalPreflightPhase,
    startListening,
    stopListening,
    stopStandaloneSongAudio,
  ]);

  const calibrateRehearsalMicrophone = useCallback(async () => {
    stopRehearsalSpeech();
    stopStandaloneSongAudio();
    setIsPreparingRehearsalMedia(true);
    setHasPreparedRehearsalMedia(false);
    setHasCompletedRehearsalPreflight(false);
    setRehearsalPreflightPhase('micro-calibration');
    setAutoListenEnabled(true);
    setTemporarilySuspendingAutoListen(false);
    resetMicrophoneCalibration();

    try {
      setRehearsalMediaStatus('Ahora calibramos el micro. Primero, guarda silencio.');
      await startListening();
      await wait(450);

      setRehearsalMediaStatus('Guarda silencio 2 segundos para medir el ruido de fondo.');
      const noiseResult = await calibrateAmbientNoise();
      setRehearsalMediaStatus(
        `Ruido base medido (${formatMicroLevel(noiseResult.noiseFloor)}). Ahora preparate para decir una frase.`
      );

      setRehearsalMediaStatus('Siri te dira la frase de prueba antes del pitido.');
      await new Promise<void>((resolve) => {
        let isResolved = false;

        const finish = () => {
          if (isResolved) {
            return;
          }
          isResolved = true;
          resolve();
        };

        speakRehearsalSpeech('Repite esta frase: prueba de micro, despues del pitido.', {
          onDone: finish,
          onError: finish,
        });
        setTimeout(finish, 5200);
      });

      setRehearsalMediaStatus('Pitido...');
      await playMicroCalibrationBeep();
      await wait(450);

      setRehearsalMediaStatus('Habla ahora: "prueba de micro". Te escucho durante 2 segundos.');
      const voiceResult = await calibrateVoiceLevel(2000);
      if (voiceResult.status === 'error') {
        setRehearsalMediaStatus(
          `No he detectado voz suficiente. Ruido ${formatMicroLevel(voiceResult.noiseFloor)}, voz ${formatMicroLevel(voiceResult.voiceLevel)}. Pulsa Reintentar calibracion y di "prueba de micro" despues del pitido.`
        );
        return;
      }

      const ratioLabel = Number.isFinite(voiceResult.voiceToNoiseRatio)
        ? voiceResult.voiceToNoiseRatio.toFixed(1)
        : 'alto';
      setRehearsalMediaStatus(
        voiceResult.status === 'weak'
          ? `Micro calibrado, aunque la voz esta cerca del ruido (ratio ${ratioLabel}x). Empezamos y lo observamos.`
          : `Micro calibrado. Umbral ${formatMicroLevel(voiceResult.voiceThreshold)}, voz ${ratioLabel}x sobre el ruido.`
      );
      await wait(650);

      void primeSongPlayback();
      markSessionPreparationReady(undefined, undefined, voiceResult);
      if (listenModeSelection === 'intelligent') {
        await releaseListening();
        setAutoListenEnabled(false);
      }
      setIsRehearsalMediaReady(true);
      setHasCompletedRehearsalPreflight(true);
      setRehearsalPreflightPhase(null);
      setRehearsalMediaStatus(null);
    } catch {
      setRehearsalMediaStatus('No se pudo calibrar el micro. Empezamos en modo manual para evitar saltos falsos.');
      setAutoListenEnabled(false);
      setListenModeSelection('manual');
      await releaseListening();
      setIsRehearsalMediaReady(true);
      setHasCompletedRehearsalPreflight(true);
      setRehearsalPreflightPhase(null);
    } finally {
      setHasPreparedRehearsalMedia(false);
      setIsPreparingRehearsalMedia(false);
    }
  }, [
    calibrateAmbientNoise,
    calibrateVoiceLevel,
    playMicroCalibrationBeep,
    primeSongPlayback,
    releaseListening,
    resetMicrophoneCalibration,
    startListening,
    stopStandaloneSongAudio,
    listenModeSelection,
    markSessionPreparationReady,
  ]);

  const handlePreflightHeardVoice = useCallback(() => {
    if (rehearsalPreflightPhase === 'manual-check') {
      if (listenModeSelection === 'manual') {
        void primeSongPlayback();
        setAutoListenEnabled(false);
        setTemporarilySuspendingAutoListen(false);
        setIsRehearsalMediaReady(true);
        setHasPreparedRehearsalMedia(false);
        setHasCompletedRehearsalPreflight(true);
        setRehearsalPreflightPhase(null);
        setRehearsalMediaStatus(null);
        markSessionPreparationReady('manual');
        void releaseListening();
        return;
      }

      void prepareRehearsalMedia('auto-final');
      return;
    }

    if (autoListenEnabled) {
      void calibrateRehearsalMicrophone();
      return;
    }

    void primeSongPlayback();
    setIsRehearsalMediaReady(true);
    setHasPreparedRehearsalMedia(false);
    setHasCompletedRehearsalPreflight(true);
    setRehearsalPreflightPhase(null);
    setRehearsalMediaStatus(null);
    markSessionPreparationReady();
  }, [
    autoListenEnabled,
    calibrateRehearsalMicrophone,
    listenModeSelection,
    markSessionPreparationReady,
    prepareRehearsalMedia,
    primeSongPlayback,
    rehearsalPreflightPhase,
    releaseListening,
  ]);

  const handlePreflightMissedVoice = useCallback(() => {
    if (rehearsalPreflightPhase === 'auto-initial') {
      void prepareRehearsalMedia('manual-check');
      return;
    }

    if (rehearsalPreflightPhase === 'manual-check') {
      if (listenModeSelection === 'manual') {
        setHasPreparedRehearsalMedia(false);
        setRehearsalMediaStatus('Repetimos la prueba de altavoz.');
        return;
      }

      void disableAutoListenForDevice(
        'La voz de prueba no se escuchaba bien con la escucha automatica. Empezamos el ensayo en modo manual.'
      ).then(() => {
        setIsRehearsalMediaReady(true);
        setHasCompletedRehearsalPreflight(true);
        setRehearsalPreflightPhase(null);
      });
      return;
    }

    void disableAutoListenForDevice(
      'La voz solo funcionaba bien sin escucha automatica. Empezamos el ensayo en modo manual.'
    ).then(() => {
      setIsRehearsalMediaReady(true);
      setHasCompletedRehearsalPreflight(true);
      setRehearsalPreflightPhase(null);
    });
  }, [disableAutoListenForDevice, listenModeSelection, prepareRehearsalMedia, rehearsalPreflightPhase]);

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

      return nextLineIndex >= 0 ? nextLineIndex : filteredGuion.length;
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

      return fallbackTargetIndex;
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
      rememberForMusicalNumberId?: string | null;
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
    if (options?.rememberForMusicalNumberId) {
      selectedMusicalNumberAudioIdsRef.current[options.rememberForMusicalNumberId] = audioId;
    }

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
    setSongAudioVolume,
    stopSongAudio,
  ]);

  useEffect(() => {
    if (!canStartRehearsalAudio) {
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
      rememberForMusicalNumberId: currentMusicalNumber.id,
      timelineCues: preferredMusicalNumberAudio.timelineCues ?? [],
    });
  }, [
    canStartRehearsalAudio,
    currentMusicalNumber,
    currentMusicalNumberKey,
    handlePlaySongAudio,
    playingAudioId,
    preferredMusicalNumberAudio,
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

    if (isSongCue(currentLine)) {
      setSongAudioVolume(1);
      return;
    }

    if (isMyTurn) {
      setSongAudioVolume(0.18);
      return;
    }

    setSongAudioVolume(0.34);
  }, [currentLine, currentMusicalNumber?.id, isMyTurn, setSongAudioVolume]);

  useEffect(() => {
    if (!canStartRehearsalAudio) {
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
    preferredSongAudio,
  ]);

  const renderHeader = (title: string) => (
    <View style={styles.header}>
      <View style={styles.headerActions}>
        <TouchableOpacity onPress={handleExit}>
          <Text style={styles.blue}>Cerrar ensayo</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={goBackLine} disabled={!canGoBack}>
          <Text style={[styles.backLink, !canGoBack && styles.backLinkDisabled]}>{'<'} Linea anterior</Text>
        </TouchableOpacity>
        {isListeningSupported && listenModeSelection === 'auto' ? (
          <TouchableOpacity
            onPress={() => {
              if (!autoListenEnabled) {
                void enableAutoListenForDevice();
              }
            }}
            disabled={autoListenEnabled}
          >
            <Text
              style={[
                styles.listenLink,
                autoListenEnabled && styles.listenLinkActive,
                !autoListenEnabled && styles.listenLinkResettable,
              ]}
            >
              {listeningStatus === 'requesting'
                ? 'Pidiendo micro...'
                : isListeningActive
                  ? 'Escucha activa'
                  : autoListenEnabled
                    ? 'Escucha automatica'
                    : 'Escucha manual'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.headerStatus}>
        <View style={styles.headerStatusTopRow}>
          <Text style={styles.sceneName}>{title}</Text>
          {compatibilityMessage ? (
            <TouchableOpacity
              style={styles.compatibilityDot}
              onPress={() => setShowCompatibilityInfo((previous) => !previous)}
            >
              <Text style={styles.compatibilityDotText}>!</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {listenModeSelection === 'auto' && autoListenEnabled ? (
          <Text style={styles.listenStatus}>
            {isListeningActive ? 'Micro escuchando tu replica' : 'Escucha lista para tu proxima replica'}
          </Text>
        ) : null}
        {listenModeSelection === 'intelligent' ? (
          <Text style={styles.listenStatus}>Autoavance inteligente beta</Text>
        ) : null}
        {compatibilityMessage && showCompatibilityInfo ? (
          <View style={styles.compatibilityPopover}>
            <Text style={styles.compatibilityPopoverText}>{compatibilityMessage}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  const renderIntelligentFeedbackBar = () => {
    if (
      listenModeSelection !== 'intelligent' ||
      (!intelligentFeedbackEntries.length && !feedbackStatusMessage)
    ) {
      return null;
    }

    return (
      <View style={styles.intelligentFeedbackBar}>
        <View style={styles.intelligentFeedbackBarTextBlock}>
          <Text style={styles.intelligentFeedbackBarTitle}>
            Informe de prueba
          </Text>
          <Text style={styles.intelligentFeedbackBarText}>
            {intelligentFeedbackEntries.length > 0
              ? `${intelligentFeedbackEntries.length} linea${intelligentFeedbackEntries.length === 1 ? '' : 's'} guardada${intelligentFeedbackEntries.length === 1 ? '' : 's'}`
              : feedbackStatusMessage}
          </Text>
        </View>
        {intelligentFeedbackEntries.length > 0 ? (
          <TouchableOpacity
            style={[styles.intelligentFeedbackBarButton, isSendingFeedback && styles.buttonDisabled]}
            onPress={() => void handleSendIntelligentFeedback()}
            disabled={isSendingFeedback}
          >
            <Text style={styles.intelligentFeedbackBarButtonText}>
              {isSendingFeedback ? 'Enviando...' : 'Enviar'}
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
  const hasSelectedRehearsalModes =
    listenModeSelection !== 'pending' && rehearsalAudioModeSelection !== 'pending';
  const canReusePreparedSession =
    hasSessionPreparedRehearsalMedia &&
    hasSelectedRehearsalModes &&
    listenModeSelection !== 'manual';
  const startConfiguredLabel = canReusePreparedSession
    ? 'Iniciar sin calibrar'
    : hasSelectedRehearsalModes
      ? 'Continuar con esta seleccion'
      : 'Empezar ensayo';

  const handleStartConfiguredRehearsal = useCallback((options?: { forceCalibration?: boolean }) => {
    if (listenModeSelection === 'pending' || rehearsalAudioModeSelection === 'pending') {
      return;
    }

    if (!options?.forceCalibration && hasSessionPreparedRehearsalMedia) {
      void restorePreparedRehearsalSession().then((wasRestored) => {
        if (!wasRestored) {
          clearSessionPreparation();
          handleStartConfiguredRehearsal({ forceCalibration: true });
        }
      });
      return;
    }

    if (options?.forceCalibration) {
      clearSessionPreparation();
    }

    setHasConfirmedRehearsalSetup(true);

    if (listenModeSelection === 'auto') {
      void enableAutoListenForDevice();
      return;
    }

    if (listenModeSelection === 'intelligent') {
      void enableIntelligentListenForDevice();
      return;
    }

    void primeSongPlayback();
    setListenModeSelection(listenModeSelection);
    setAutoListenEnabled(false);
    setTemporarilySuspendingAutoListen(false);
    setIsRehearsalMediaReady(true);
    setIsPreparingRehearsalMedia(false);
    setHasPreparedRehearsalMedia(false);
    setHasCompletedRehearsalPreflight(true);
    setRehearsalPreflightPhase(null);
    setRehearsalMediaStatus(null);
    setCompatibilityMessage(null);
    setShowCompatibilityInfo(false);
    markSessionPreparationReady('manual');
    void releaseListening();
    void stopRecognition();
  }, [
    clearSessionPreparation,
    enableAutoListenForDevice,
    enableIntelligentListenForDevice,
    hasSessionPreparedRehearsalMedia,
    listenModeSelection,
    markSessionPreparationReady,
    primeSongPlayback,
    releaseListening,
    rehearsalAudioModeSelection,
    restorePreparedRehearsalSession,
    stopRecognition,
  ]);

  if (shouldShowInitialSetup) {
    return (
      <View style={styles.container}>
        {renderHeader('Configurar ensayo')}
        <ScrollView
          contentContainerStyle={styles.preflightScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.preflightCard}>
            <Text style={styles.preflightTitle}>Como quieres ensayar?</Text>
            <Text style={styles.preflightText}>
              Puedes ensayar manualmente, con silencio automatico o probar el modo inteligente
              experimental.
            </Text>
            <Text style={styles.preflightStatus}>
              Selecciona Ensayar sin micro si todavia no estas confiado con tus frases y necesitas
              leerlas con calma.
            </Text>
            {hasSelectedRehearsalModes ? (
              <Text style={styles.preflightStatusSecondary}>
                Hemos dejado seleccionados tus ultimos modos. Puedes continuar con ellos o cambiarlos
                aqui mismo.
              </Text>
            ) : null}
            {canReusePreparedSession ? (
              <Text style={styles.preflightStatus}>
                Audio y micro ya preparados en esta sesion.
              </Text>
            ) : null}
            {canReusePreparedSession ? (
              <TouchableOpacity
                style={[styles.preflightActionButton, styles.preflightFallbackButton]}
                onPress={() => handleStartConfiguredRehearsal({ forceCalibration: true })}
              >
                <Text style={styles.preflightFallbackText}>Recalibrar antes de empezar</Text>
              </TouchableOpacity>
            ) : null}
            <Text style={styles.preflightSectionTitle}>Modo de dialogo</Text>
            <View style={styles.preflightActions}>
              <TouchableOpacity
                style={[
                  styles.preflightActionButton,
                  listenModeSelection === 'auto'
                    ? styles.preflightConfirmButton
                    : styles.preflightUnselectedButton,
                ]}
                onPress={() => handleSelectListenMode('auto')}
              >
                <Text
                  style={[
                    styles.preflightConfirmText,
                    listenModeSelection !== 'auto' && styles.preflightUnselectedButtonText,
                  ]}
                >
                  Micro por silencio
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.preflightActionButton,
                  listenModeSelection === 'intelligent'
                    ? styles.preflightIntelligentButton
                    : styles.preflightUnselectedButton,
                  !isSpeechRecognitionSupported && styles.buttonDisabled,
                ]}
                onPress={() => {
                  if (isSpeechRecognitionSupported) {
                    handleSelectListenMode('intelligent');
                  }
                }}
                disabled={!isSpeechRecognitionSupported}
              >
                <Text
                  style={[
                    styles.preflightConfirmText,
                    listenModeSelection !== 'intelligent' && styles.preflightUnselectedButtonText,
                  ]}
                >
                  Autoavance inteligente beta
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.preflightActionButton,
                  listenModeSelection === 'manual'
                    ? styles.preflightManualButton
                    : styles.preflightUnselectedButton,
                ]}
                onPress={() => handleSelectListenMode('manual')}
              >
                <Text
                  style={[
                    styles.preflightManualText,
                    listenModeSelection !== 'manual' && styles.preflightUnselectedButtonText,
                  ]}
                >
                  Ensayar sin micro
                </Text>
              </TouchableOpacity>
            </View>
            {!isSpeechRecognitionSupported ? (
              <Text style={styles.preflightStatusSecondary}>
                Este navegador no ofrece reconocimiento de voz web. Puedes usar silencio o modo manual.
              </Text>
            ) : null}
            <Text style={styles.preflightSectionTitle}>Modo musical</Text>
            <Text style={styles.preflightText}>
              Priorizaremos ese tipo de audio en canciones y numeros musicales. Si no existe,
              usaremos automaticamente el otro.
            </Text>
            <View style={styles.preflightActions}>
              <TouchableOpacity
                style={[
                  styles.preflightActionButton,
                  rehearsalAudioModeSelection === 'karaoke'
                    ? styles.preflightMusicKaraokeButton
                    : styles.preflightUnselectedButton,
                ]}
                onPress={() => handleSelectRehearsalAudioMode('karaoke')}
              >
                <Text
                  style={[
                    styles.preflightConfirmText,
                    rehearsalAudioModeSelection !== 'karaoke' && styles.preflightUnselectedButtonText,
                  ]}
                >
                  Karaoke
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.preflightActionButton,
                  rehearsalAudioModeSelection === 'vocal_guide'
                    ? styles.preflightMusicGuideButton
                    : styles.preflightUnselectedButton,
                ]}
                onPress={() => handleSelectRehearsalAudioMode('vocal_guide')}
              >
                <Text
                  style={[
                    styles.preflightConfirmText,
                    rehearsalAudioModeSelection !== 'vocal_guide' &&
                      styles.preflightUnselectedButtonText,
                  ]}
                >
                  Vocal guide
                </Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[
                styles.btnNext,
                (listenModeSelection === 'pending' || rehearsalAudioModeSelection === 'pending') &&
                  styles.buttonDisabled,
              ]}
              onPress={() => handleStartConfiguredRehearsal()}
              disabled={
                listenModeSelection === 'pending' || rehearsalAudioModeSelection === 'pending'
              }
            >
              <Text style={styles.btnText}>{startConfiguredLabel}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
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
                  rememberForMusicalNumberId: currentMusicalNumber?.id ?? null,
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
                    rememberForMusicalNumberId: currentMusicalNumber?.id ?? null,
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
    );
  };

  const renderIntelligentLinePanel = () => {
    if (!isMyTurn || listenModeSelection !== 'intelligent') {
      return null;
    }

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
    const scoreToneStyle =
      automaticReason || intelligentLineMatch.score >= 0.88
        ? styles.intelligentScoreGood
        : intelligentLineMatch.score >= 0.65
          ? styles.intelligentScoreWarning
          : styles.intelligentScoreLow;

    return (
      <View style={styles.intelligentPanel}>
        <Text style={styles.intelligentTitle}>Laboratorio de linea</Text>
        <Text style={styles.intelligentHint}>
          Avanzamos si la coincidencia supera {Math.round(INTELLIGENT_AUTO_ADVANCE_THRESHOLD * 100)}% o si el cierre
          de la replica encaja bien. El detalle queda guardado para repasar despues.
          Tambien puedes decir Linea buena para aceptar la replica por voz.
        </Text>
        <View style={styles.intelligentTranscriptBlock}>
          <Text style={styles.intelligentLabel}>Debias decir</Text>
          <Text style={styles.intelligentExpectedText}>{currentLine?.t}</Text>
        </View>
        <View style={styles.intelligentTranscriptBlock}>
          <Text style={styles.intelligentLabel}>He oido</Text>
          <Text style={styles.intelligentHeardText}>
            {speechRecognitionTranscript || 'Aun no hay transcripcion...'}
          </Text>
          {speechRecognitionInterimTranscript ? (
            <Text style={styles.intelligentInterimText}>
              Parcial: {speechRecognitionInterimTranscript}
            </Text>
          ) : null}
        </View>
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
        {speechRecognitionError ? (
          <Text style={styles.listenError}>{speechRecognitionError}</Text>
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
            style={[styles.intelligentButton, styles.intelligentRetryButton, !hasTranscript && styles.buttonDisabled]}
            onPress={handleRetryIntelligentLine}
            disabled={!hasTranscript}
          >
            <Text style={styles.intelligentRetryText}>Reintentar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.intelligentButton, styles.intelligentSkipButton]}
            onPress={handleSkipIntelligentLine}
          >
            <Text style={styles.intelligentButtonText}>Siguiente linea</Text>
          </TouchableOpacity>
        </View>
        {intelligentFeedbackEntries.length > 0 ? (
          <TouchableOpacity
            style={[styles.intelligentSendButton, isSendingFeedback && styles.buttonDisabled]}
            onPress={() => void handleSendIntelligentFeedback()}
            disabled={isSendingFeedback}
          >
            <Text style={styles.intelligentSendButtonText}>
              {isSendingFeedback
                ? 'Enviando informe...'
                : `Enviar informe (${intelligentFeedbackEntries.length})`}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const renderPreflightSteps = () => {
    const isManualMode = listenModeSelection === 'manual';
    const isAudioStepDone =
      hasPreparedRehearsalMedia ||
      rehearsalPreflightPhase === 'micro-calibration' ||
      isRehearsalMediaReady;
    const isMicroStepDone =
      isManualMode || (isRehearsalMediaReady && listenModeSelection === 'auto');
    const steps: {
      title: string;
      detail: string;
      state: 'done' | 'active' | 'pending' | 'skipped';
    }[] = [
      {
        title: 'Altavoz',
        detail: 'Escucha una frase corta.',
        state: isAudioStepDone ? 'done' : 'active',
      },
      {
        title: 'Micro',
        detail: isManualMode ? 'No se activara.' : 'Habla tras el pitido.',
        state: isManualMode
          ? 'skipped'
          : rehearsalPreflightPhase === 'micro-calibration'
            ? 'active'
            : isMicroStepDone
              ? 'done'
              : 'pending',
      },
      {
        title: 'Ensayo',
        detail: 'Entramos en la obra.',
        state: isRehearsalMediaReady ? 'done' : isAudioStepDone && isManualMode ? 'active' : 'pending',
      },
    ];

    return (
      <View style={styles.preflightSteps}>
        {steps.map((step) => (
          <View key={step.title} style={styles.preflightStep}>
            <View
              style={[
                styles.preflightStepBadge,
                step.state === 'done' && styles.preflightStepBadgeDone,
                step.state === 'active' && styles.preflightStepBadgeActive,
                step.state === 'skipped' && styles.preflightStepBadgeSkipped,
              ]}
            >
              <Text
                style={[
                  styles.preflightStepBadgeText,
                  step.state !== 'pending' && styles.preflightStepBadgeTextActive,
                ]}
              >
                {step.state === 'done'
                  ? 'OK'
                  : step.state === 'active'
                    ? 'Ahora'
                    : step.state === 'skipped'
                      ? 'Sin'
                      : 'Luego'}
              </Text>
            </View>
            <Text style={styles.preflightStepTitle}>{step.title}</Text>
            <Text style={styles.preflightStepDetail}>{step.detail}</Text>
          </View>
        ))}
      </View>
    );
  };

  if (!isRehearsalMediaReady) {
    return (
      <View style={styles.container}>
        {renderHeader(listenModeSelection === 'manual' ? 'Preparando audio' : 'Preparando audio y micro')}
        <ScrollView
          contentContainerStyle={styles.preflightScrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.preflightCard}>
            {renderPreflightSteps()}
            <Text style={styles.preflightTitle}>
              {rehearsalPreflightPhase === 'micro-calibration'
                ? 'Calibrar micro'
                : listenModeSelection === 'manual'
                  ? 'Probar altavoz'
                  : 'Preparar ensayo'}
            </Text>
            <Text style={styles.preflightText}>
              {rehearsalPreflightPhase === 'micro-calibration'
                ? 'Sigue las instrucciones. Habla despues del pitido.'
                : listenModeSelection === 'manual'
                  ? 'Entramos sin activar el micro.'
                  : 'Ahora vamos a simular el ensayo.'}
            </Text>
            {rehearsalMediaStatus ? (
              <Text style={styles.preflightStatus}>{rehearsalMediaStatus}</Text>
            ) : null}
            {autoListenEnabled && rehearsalPreflightPhase === 'micro-calibration' ? (
              <View style={styles.microCalibrationBox}>
                <View style={styles.microCalibrationMeterTrack}>
                  <View
                    style={[
                      styles.microCalibrationMeterFill,
                      {
                        width: `${Math.max(4, Math.round(signalLevel * 100))}%`,
                        backgroundColor:
                          microphoneCalibrationStatus === 'weak' ? '#d98a00' : '#2b9348',
                      },
                    ]}
                  />
                </View>
                <Text style={styles.microCalibrationText}>
                  Calibracion micro:{' '}
                  {microphoneCalibrationStatus === 'measuring-silence'
                    ? `midiendo silencio ${Math.round(microphoneCalibrationProgress * 100)}%`
                    : microphoneCalibrationStatus === 'measuring-voice'
                      ? `midiendo voz ${Math.round(microphoneCalibrationProgress * 100)}%`
                      : microphoneCalibrationStatus === 'ready'
                        ? 'lista'
                        : microphoneCalibrationStatus === 'weak'
                          ? 'voz debil frente al ruido'
                          : 'pendiente'}
                </Text>
                <Text style={styles.microCalibrationTextSmall}>
                  Actual {formatMicroLevel(rawLevel)} - Ruido {formatMicroLevel(microphoneNoiseFloor)} - Voz{' '}
                  {formatMicroLevel(microphoneVoiceLevel)} - Umbral {formatMicroLevel(voiceThreshold)}
                </Text>
              </View>
            ) : null}
            {!hasPreparedRehearsalMedia ? (
              <TouchableOpacity
                style={[styles.btnNext, isPreparingRehearsalMedia && styles.buttonDisabled]}
                onPress={() =>
                  void (rehearsalPreflightPhase === 'micro-calibration'
                    ? calibrateRehearsalMicrophone()
                    : prepareRehearsalMedia())
                }
                disabled={isPreparingRehearsalMedia}
              >
                <Text style={styles.btnText}>
                  {isPreparingRehearsalMedia
                    ? 'Preparando...'
                    : rehearsalPreflightPhase === 'micro-calibration'
                      ? 'Reintentar calibracion'
                      : 'Preparar audio y micro'}
                </Text>
              </TouchableOpacity>
            ) : null}
            {hasPreparedRehearsalMedia ? (
              <View style={styles.preflightActions}>
                <TouchableOpacity
                  style={[styles.preflightActionButton, styles.preflightConfirmButton]}
                  onPress={handlePreflightHeardVoice}
                >
                  <Text style={styles.preflightConfirmText}>
                    {rehearsalPreflightPhase === 'manual-check' && listenModeSelection === 'manual'
                      ? 'Empezar sin micro'
                      : rehearsalPreflightPhase === 'manual-check'
                      ? 'Ahora si la oigo'
                      : rehearsalPreflightPhase === 'auto-final'
                        ? 'Perfecto, se oye'
                        : 'Si, la oigo'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.preflightActionButton, styles.preflightFallbackButton]}
                  onPress={handlePreflightMissedVoice}
                >
                  <Text style={styles.preflightFallbackText}>
                    {rehearsalPreflightPhase === 'manual-check' && listenModeSelection === 'manual'
                      ? 'Repetir prueba'
                      : rehearsalPreflightPhase === 'manual-check'
                      ? 'Sigue sin oirse'
                      : rehearsalPreflightPhase === 'auto-final'
                        ? 'No se oye con micro'
                        : 'No la oigo'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </ScrollView>
      </View>
    );
  }

  if (isSceneMarker(currentLine)) {
    return (
      <View style={styles.container}>
        {renderHeader('Cambio de escena')}
        {renderIntelligentFeedbackBar()}
        <View style={styles.intro}>
          <Text style={styles.introTitle}>Escena: {currentLine.t}</Text>
          <TouchableOpacity style={styles.btnNext} onPress={advanceLine}>
            <Text style={styles.btnText}>Empezar esta escena</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (isSongCue(currentLine)) {
    return (
      <View style={styles.container}>
        {renderHeader('Cancion dentro de la escena')}
        {renderIntelligentFeedbackBar()}

        <ScrollView contentContainerStyle={styles.center}>
          <View style={styles.songBox}>
            <Text style={styles.songBadge}>Cancion</Text>
            <Text style={styles.songTitle}>{currentLine.songTitle || 'Cancion'}</Text>
            {currentLine.a ? <Text style={styles.acot}>[{currentLine.a}]</Text> : null}

            {currentMusicalNumber && shouldShowCurrentAudioOptions ? (
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
                          rememberForMusicalNumberId: currentMusicalNumber?.id ?? null,
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
                            rememberForMusicalNumberId: currentMusicalNumber?.id ?? null,
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
      {renderHeader(`Ensayando ${filterScenes.length} escenas`)}
      {renderIntelligentFeedbackBar()}

      <ScrollView contentContainerStyle={styles.center}>
        {isFinished ? (
          <View style={styles.finishedBox}>
            <Text style={styles.finishedTitle}>Fin del ensayo</Text>
            {listenModeSelection === 'intelligent' && intelligentFeedbackEntries.length > 0 ? (
              <TouchableOpacity
                style={[styles.intelligentSendButton, isSendingFeedback && styles.buttonDisabled]}
                onPress={() => void handleSendIntelligentFeedback()}
                disabled={isSendingFeedback}
              >
                <Text style={styles.intelligentSendButtonText}>
                  {isSendingFeedback
                    ? 'Enviando informe...'
                    : `Enviar informe de prueba (${intelligentFeedbackEntries.length})`}
                </Text>
              </TouchableOpacity>
            ) : null}
            {feedbackStatusMessage ? (
              <Text style={styles.intelligentFeedbackStatus}>{feedbackStatusMessage}</Text>
            ) : null}
            <TouchableOpacity onPress={handleExit} style={styles.btnBack}>
              <Text style={styles.btnText}>Volver al inicio</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.box, isMyTurn && styles.myBox]}>
            <Text style={[styles.name, isMyTurn && styles.myName]}>{currentLine?.p}</Text>
            {currentLine?.a ? <Text style={styles.acot}>[{currentLine.a}]</Text> : null}
            <Text style={[styles.text, isMyTurn && styles.myText]}>{currentLine?.t}</Text>
            {isMyTurn && (
              <Text style={styles.myTurnHint}>
                {listenModeSelection === 'intelligent'
                  ? 'Tu turno: habla con naturalidad. Si la app no entiende, se quedara parada.'
                  : 'Tu turno: lee y guardaremos silencio para pasar solos, o pulsa siguiente si lo prefieres.'}
              </Text>
            )}
            {isMyTurn && listeningStatus === 'error' && listeningError ? (
              <Text style={styles.listenError}>{listeningError}</Text>
            ) : null}
            {isMyTurn && autoListenEnabled ? (
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
            {!isMyTurn && speechStatusMessage ? (
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

      {!isFinished && (
        <TouchableOpacity style={[styles.footer, isMyTurn && styles.footerActive]} onPress={advanceLine}>
          <Text style={styles.btnText}>{isMyTurn ? 'Hecho (siguiente)' : 'Saltar linea'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
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
    borderColor: '#bde4ec',
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
  center: { flexGrow: 1, justifyContent: 'center', padding: 25 },
  intro: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  introTitle: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 30 },
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
    backgroundColor: '#f8fbff',
    borderWidth: 1,
    borderColor: '#d7e6f5',
    gap: 16,
  },
  preflightTitle: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    color: '#17324c',
  },
  preflightText: {
    textAlign: 'center',
    lineHeight: 22,
    color: '#47604f',
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
  finishedTitle: { fontSize: 20, fontWeight: 'bold' },
  box: { padding: 30, borderRadius: 20, backgroundColor: '#f8f9fa', alignItems: 'center' },
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
  myBox: { backgroundColor: '#fff0f0', borderWidth: 2, borderColor: 'red' },
  name: { fontSize: 22, fontWeight: '900', marginBottom: 10 },
  myName: { color: 'red' },
  acot: { fontStyle: 'italic', color: '#666', marginBottom: 15 },
  text: { fontSize: 26, textAlign: 'center', lineHeight: 38 },
  myText: { color: '#d32f2f', fontWeight: '500' },
  myTurnHint: { marginTop: 20, fontSize: 14, color: '#d32f2f', fontWeight: 'bold' },
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
    backgroundColor: 'rgba(238, 252, 255, 0.94)',
    borderWidth: 1,
    borderColor: '#bde4ec',
    gap: 10,
  },
  intelligentTitle: {
    color: '#15515b',
    fontWeight: '900',
    fontSize: 16,
    textAlign: 'center',
  },
  intelligentHint: {
    color: '#47604f',
    lineHeight: 19,
    textAlign: 'center',
    fontSize: 13,
  },
  intelligentTranscriptBlock: {
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderWidth: 1,
    borderColor: '#d5edf2',
    gap: 4,
  },
  intelligentLabel: {
    color: '#15515b',
    fontWeight: '800',
    textTransform: 'uppercase',
    fontSize: 11,
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  intelligentExpectedText: {
    color: '#17324c',
    lineHeight: 22,
    textAlign: 'center',
  },
  intelligentHeardText: {
    color: '#2b2b2b',
    lineHeight: 22,
    textAlign: 'center',
    fontWeight: '600',
  },
  intelligentInterimText: {
    color: '#6a7d88',
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
    color: '#2b9348',
  },
  intelligentScoreWarning: {
    color: '#d98a00',
  },
  intelligentScoreLow: {
    color: '#b3261e',
  },
  intelligentMetaText: {
    color: '#4f6274',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  intelligentFeedbackStatus: {
    color: '#15515b',
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
  intelligentSendButton: {
    marginTop: 2,
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#15515b',
  },
  intelligentSendButtonText: {
    color: '#fff',
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
