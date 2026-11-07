import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { submitIntelligentLineFeedback } from '../api/sharedScripts';
import { useSilenceAdvance, type MicrophoneCalibrationSnapshot } from '../hooks/useSilenceAdvance';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { SpeechRecognitionErrorPanel } from './SpeechRecognitionErrorPanel';
import { MicrophoneSettings } from './MicrophoneSettings';
import { Button, Chip, Icon, palette, Sheet, ui } from './PracticeUI';
import { resolveListenPreference, resolveTranscriptPreference, supportsRecognition } from '../utils/rehearsalPreferences';
import { canBeginPreparedRehearsal, runRehearsalMicrophoneCalibration } from '../utils/rehearsalPreparation';
import {
  INTELLIGENT_LINE_VARIANTS_STORAGE_PREFIX,
  LEGACY_REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY,
  REHEARSAL_AUDIO_SELECTION_STORAGE_PREFIX,
  REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY,
  REHEARSAL_AUDIO_MODE_STORAGE_KEY,
  REHEARSAL_LISTEN_MODE_STORAGE_KEY,
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
  type AutomaticLineMatchReason,
  getAutomaticLineMatchReason,
  getGoodLineCommandAcceptedText,
  hashLineText,
  inferSpeechRecognitionLanguage,
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
  spokenOnly?: boolean;
  onProgressChange?: (lineIndex: number, totalLines: number) => void;
  onExit: () => void;
}

type RehearsalPreflightPhase =
  | 'audio-check'
  | 'micro-calibration'
  | 'ready-to-listen'
  | 'intelligent-check'
  | 'recognition-audio-check'
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
const APP_LINE_ADVANCE_DELAY_MS = 220;
const USER_LINE_RESPONSE_BUFFER_MS = 550;
const INTERIM_SAFE_AUTO_ADVANCE_REASONS = new Set<AutomaticLineMatchReason>([
  'global_score',
  'high_final_confidence',
  'strong_coverage',
]);
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
  const [showTranscript, setShowTranscript] = useState(true);
  const [showMicrophoneMenu, setShowMicrophoneMenu] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
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
  const preparationRunRef = useRef(0);
  const calibrationResultRef = useRef<MicrophoneCalibrationSnapshot | null>(null);
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
  const currentLineVariantKey =
    !isFinished && currentLine && currentLineIndexInScript >= 0
      ? buildLineVariantKey(currentLineIndexInScript, currentLine.t)
      : null;
  const currentAcceptedLineVariants = useMemo(
    () => (currentLineVariantKey ? lineVariants[currentLineVariantKey] ?? [] : []),
    [currentLineVariantKey, lineVariants]
  );
  const intelligentRecognitionLanguage = useMemo(() => {
    const nextActorLine = filteredGuion.slice(currentIndex).find((line) =>
      !isSceneMarker(line) && !isSongCue(line) && lineMatchesRoles(line, myRoles)
    );
    return inferSpeechRecognitionLanguage(isMyTurn ? speakableLineText : nextActorLine?.t ?? speakableLineText);
  }, [currentIndex, filteredGuion, isMyTurn, myRoles, speakableLineText]);
  const isIntelligentListenMode = listenModeSelection === 'intelligent';
  const isCheckingIntelligentRecognition = isIntelligentListenMode && rehearsalPreflightPhase === 'intelligent-check';
  const recognitionPreparationKey = `prepare:${resolvedScriptId}`;
  const effectiveAutoListenEnabled = autoListenEnabled && !temporarilySuspendingAutoListen;
  const canRunRehearsalLinePlayback =
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
  const shouldUseIntelligentRecognition =
    canRunRehearsalLinePlayback &&
    isIntelligentListenMode &&
    !isFinished &&
    Boolean(currentLine) &&
    !isSceneMarker(currentLine) &&
    !isCurrentMusicalSongBlock &&
    isMyTurn &&
    speakableLineText.length > 0;
  const shouldKeepIntelligentRecognitionWarm =
    isCheckingIntelligentRecognition ||
    (isIntelligentListenMode && rehearsalPreflightPhase === 'recognition-audio-check') ||
    shouldUseIntelligentRecognition ||
    (
      isMobileSpeechDevice &&
      isIntelligentListenMode &&
      canRunRehearsalLinePlayback &&
      !isFinished &&
      Boolean(currentLine) &&
      !isCurrentMusicalSongBlock
    );
  const shouldSuspendListeningDuringSong =
    canRunRehearsalLinePlayback &&
    effectiveAutoListenEnabled &&
    Boolean(currentLine) &&
    isCurrentMusicalSongBlock;
  const recognitionLineKey =
    (isCheckingIntelligentRecognition || rehearsalPreflightPhase === 'recognition-audio-check') ? recognitionPreparationKey :
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

  useEffect(() => {
    if (!canRunRehearsalLinePlayback || !isSceneMarker(currentLine)) return;
    const timer = setTimeout(advanceLine, 600);
    return () => clearTimeout(timer);
  }, [advanceLine, canRunRehearsalLinePlayback, currentLine]);

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
    microphoneCalibrationProgress,
    lineStateLabel,
    calibrateAmbientNoise,
    calibrateVoiceLevel,
    resetMicrophoneCalibration,
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
    status: speechRecognitionStatus,
    transcript: speechRecognitionTranscript,
    interimTranscript: speechRecognitionInterimTranscript,
    isAudioActive: isRecognitionAudioActive,
    error: speechRecognitionError,
    errorCode: speechRecognitionErrorCode,
    errorDetail: speechRecognitionErrorDetail,
    resetTranscript: resetSpeechRecognitionTranscript,
    activateRecognition,
    restartRecognition,
    stopRecognition,
  } = useSpeechRecognition({
    enabled: shouldKeepIntelligentRecognitionWarm,
    lang: intelligentRecognitionLanguage,
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
    const automaticReason = getAutomaticLineMatchReason(
      speakableLineText,
      speechRecognitionTranscript,
      intelligentLineMatch
    );
    const hasBlockingInterimTranscript =
      speechRecognitionInterimTranscript.trim() &&
      intelligentLineMatch.score < 0.95 &&
      (
        !automaticReason ||
        !INTERIM_SAFE_AUTO_ADVANCE_REASONS.has(automaticReason)
      );

    if (
      !shouldUseIntelligentRecognition ||
      !currentLineVariantKey ||
      !currentLine ||
      currentLineIndexInScript < 0 ||
      hasBlockingInterimTranscript ||
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
      await releaseListening();

      try {
        await AsyncStorage.setItem(REHEARSAL_AUDIO_COMPATIBILITY_STORAGE_KEY, storedValue);
      } catch (error) {
        console.error('Error guardando compatibilidad de audio', error);
      }
    },
    [releaseListening]
  );

  const enableIntelligentListenForDevice = useCallback(() => {
    if (!speakerConfirmed || !calibrationResultRef.current) return;
    stopRehearsalSpeech();
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
    activateRecognition({ lang: intelligentRecognitionLanguage, lineKey: recognitionPreparationKey });
  }, [activateRecognition, intelligentRecognitionLanguage, recognitionPreparationKey, speakerConfirmed]);

  useEffect(() => {
    if (!isCheckingIntelligentRecognition || !isRecognitionAudioActive) return;
    resetSpeechRecognitionTranscript();
    setHasPreparedRehearsalMedia(false);
    setRehearsalPreflightPhase('recognition-audio-check');
    setRehearsalMediaStatus('La escucha está abierta. Comprueba que también oyes la voz de la app.');
  }, [isCheckingIntelligentRecognition, isRecognitionAudioActive, resetSpeechRecognitionTranscript]);

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
        const [storedListenMode, storedAudioMode, storedTranscript] = await Promise.all([
          AsyncStorage.getItem(REHEARSAL_LISTEN_MODE_STORAGE_KEY),
          AsyncStorage.getItem(REHEARSAL_AUDIO_MODE_STORAGE_KEY),
          AsyncStorage.getItem(REHEARSAL_TRANSCRIPT_STORAGE_KEY),
        ]);

        if (!isMounted) {
          return;
        }

        setListenModeSelection(resolveListenPreference(storedListenMode, isSpeechRecognitionSupported));
        setShowTranscript(resolveTranscriptPreference(storedTranscript));

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
        void startListening();
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
    preparationRunRef.current += 1;
    stopRehearsalSpeech();
    disposeSongAudio();
    stopRecognition();
    void releaseListening();
    onExit();
  };

  const currentAudioModeLabel = currentMusicalNumber ? 'numero musical' : 'cancion';
  const shouldShowCurrentAudioOptions = currentRehearsalAudioOptions.length > 0;

  const prepareRehearsalMedia = useCallback((withRecognition = false) => {
    const run = ++preparationRunRef.current;
    stopRehearsalSpeech(); stopStandaloneSongAudio();
    setIsPreparingRehearsalMedia(true);
    setHasPreparedRehearsalMedia(false);
    setRehearsalMediaStatus('Escucha la frase de prueba.');
    setRehearsalPreflightPhase(withRecognition ? 'recognition-audio-check' : 'audio-check');
    // Synthesis starts in this tap, before any await, to unlock Safari output.
    let finished = false;
    const finish = (error = false) => {
      if (finished) return;
      finished = true; clearTimeout(timeout);
      if (preparationRunRef.current !== run) return;
      setIsPreparingRehearsalMedia(false);
      setHasPreparedRehearsalMedia(!error);
      setRehearsalMediaStatus(error
        ? 'No se pudo completar la prueba de voz. Pulsa Probar voz para reintentar.'
        : '¿Has oído claramente la frase de la app?');
    };
    const timeout = setTimeout(() => finish(true), 7000);
    speakRehearsalSpeech('Hola, hola, dime si me oyes.', {
      onStart: () => { if (preparationRunRef.current === run) setRehearsalMediaStatus('Sonando: «Hola, hola, dime si me oyes».'); },
      onDone: () => finish(), onError: () => finish(true),
    });
    if (!spokenOnly) void primeSongPlayback();
  }, [primeSongPlayback, spokenOnly, stopStandaloneSongAudio]);

  const calibrateRehearsalMicrophone = useCallback(async () => {
    const run = ++preparationRunRef.current;
    const isCurrent = () => preparationRunRef.current === run;
    stopRehearsalSpeech(); stopStandaloneSongAudio(); stopRecognition();
    setIsPreparingRehearsalMedia(true); setHasPreparedRehearsalMedia(false);
    setHasCompletedRehearsalPreflight(false); setIsRehearsalMediaReady(false);
    setRehearsalPreflightPhase('micro-calibration'); setAutoListenEnabled(false);
    setSpeakerConfirmed(false); setMicrophoneCalibrated(false); calibrationResultRef.current = null;
    resetMicrophoneCalibration();
    try {
      const result = await runRehearsalMicrophoneCalibration({
        isCurrent, start: startListening, measureNoise: calibrateAmbientNoise,
        prompt: () => new Promise<void>((resolve) => {
          let finished = false;
          const finish = () => { if (!finished) { finished = true; clearTimeout(timeout); resolve(); } };
          const timeout = setTimeout(finish, 5200);
          speakRehearsalSpeech('Di prueba de micro después del pitido.', { onDone: finish, onError: finish });
        }),
        beep: playMicroCalibrationBeep, measureVoice: () => calibrateVoiceLevel(2200),
        release: releaseListeningInput,
        onStage: (stage) => setRehearsalMediaStatus(stage === 'silence'
          ? 'Guarda silencio: estamos midiendo el ruido de fondo.'
          : stage === 'prompt' ? 'Después del pitido, di «prueba de micro».'
          : 'Habla ahora: «prueba de micro». Estamos midiendo tu voz.'),
      });
      if (!isCurrent()) return;
      calibrationResultRef.current = result; setMicrophoneCalibrated(true);
      setRehearsalPreflightPhase('audio-check');
      setRehearsalMediaStatus(result.status === 'weak'
        ? 'Micro calibrado. Habla cerca del teléfono para que tu voz destaque sobre el ruido.'
        : 'Micro calibrado. Ahora pulsa Probar voz para comprobar el altavoz.');
    } catch (error) {
      if (!isCurrent()) return;
      setRehearsalMediaStatus(error instanceof Error && error.message === 'voice-not-detected'
        ? 'No se ha detectado suficiente voz. Repite la calibración y habla después del pitido.'
        : 'No se pudo calibrar el micrófono. Comprueba el permiso del navegador y vuelve a intentarlo.');
    } finally {
      if (isCurrent()) setIsPreparingRehearsalMedia(false);
    }
  }, [calibrateAmbientNoise, calibrateVoiceLevel, playMicroCalibrationBeep,
    releaseListeningInput, resetMicrophoneCalibration, startListening, stopRecognition, stopStandaloneSongAudio]);

  const finishRehearsalPreparation = useCallback((speakerWithRecognitionConfirmed = false) => {
    if (listenModeSelection === 'pending' || !canBeginPreparedRehearsal(listenModeSelection, {
      speakerConfirmed, microphoneCalibrated, recognitionAudioActive: isRecognitionAudioActive,
      speakerWithRecognitionConfirmed,
    })) {
      setRehearsalMediaStatus('Falta comprobar la escucha. Vuelve a abrirla y repite la prueba de voz.');
      return;
    }
    resetSpeechRecognitionTranscript();
    setAutoListenEnabled(listenModeSelection === 'auto'); setTemporarilySuspendingAutoListen(false);
    setHasCompletedRehearsalPreflight(true); setIsRehearsalMediaReady(true);
    setRehearsalPreflightPhase(null); setRehearsalMediaStatus(null);
  }, [isRecognitionAudioActive, listenModeSelection, microphoneCalibrated, resetSpeechRecognitionTranscript, speakerConfirmed]);

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

  const renderHeader = (title: string) => <>
    <View style={[ui.header, { paddingVertical: 10 }]}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cerrar ensayo" onPress={handleExit} style={ui.icon}><Icon name="arrow-left" /></TouchableOpacity>
      <View style={{ flex: 1, gap: 3 }}><Text numberOfLines={1} style={[ui.text, { fontSize: 12 }]}>{title}</Text><Text numberOfLines={1} style={{ color: palette.ink, fontWeight: '600' }}>{scriptTitle || 'Ensayo'}</Text></View>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Micrófono y voz" onPress={() => setShowMicrophoneMenu(true)} style={[ui.row, { gap: 4, minHeight: 46 }]}>
        <Icon name={listenModeSelection === 'manual' ? 'microphone-off' : 'microphone-outline'} size={20} />
        <Text style={{ color: palette.plum, fontSize: 12, fontWeight: '700' }}>{listenModeSelection === 'intelligent' ? 'Inteligente' : listenModeSelection === 'auto' ? 'Silencio' : 'Manual'} ⌄</Text>
      </TouchableOpacity>
    </View>
    <Sheet title="Micrófono y voz" visible={showMicrophoneMenu} onClose={() => setShowMicrophoneMenu(false)}>
      <MicrophoneSettings mode={listenModeSelection === 'pending' ? 'intelligent' : listenModeSelection} supported={isSpeechRecognitionSupported}
        onModeChange={(mode) => {
          if (mode === listenModeSelection) return;
          preparationRunRef.current += 1; calibrationResultRef.current = null; setSpeakerConfirmed(false); setMicrophoneCalibrated(false);
          stopRehearsalSpeech(); stopStandaloneSongAudio(); stopRecognition(); void releaseListening();
          setIsPaused(false); setHasConfirmedRehearsalSetup(false); setRehearsalPreflightPhase(null);
          handleSelectListenMode(mode);
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
  const handleStartConfiguredRehearsal = useCallback(() => {
    if (listenModeSelection === 'pending' || rehearsalAudioModeSelection === 'pending') return;
    setHasConfirmedRehearsalSetup(true); setSpeakerConfirmed(false); setMicrophoneCalibrated(false);
    calibrationResultRef.current = null; setHasCompletedRehearsalPreflight(false);
    setIsRehearsalMediaReady(false); setAutoListenEnabled(false); setCompatibilityMessage(null);
    stopRecognition();
    if (listenModeSelection === 'manual') prepareRehearsalMedia();
    else {
      void primeSongPlayback();
      void calibrateRehearsalMicrophone();
    }
  }, [calibrateRehearsalMicrophone, listenModeSelection, prepareRehearsalMedia, primeSongPlayback, rehearsalAudioModeSelection, stopRecognition]);

  if (shouldShowInitialSetup) {
    return <View style={styles.container}>
      {renderHeader('Listo para ensayar')}
      <ScrollView contentContainerStyle={[ui.page, { paddingTop: 40 }]}>
        <Text style={ui.label}>TU ENSAYO</Text>
        <Text style={ui.title}>{initialIndex > 0 ? 'Seguimos donde lo dejaste' : 'Vamos a escena'}</Text>
        <Text style={ui.text}>{myRoles.join(', ')} · {filterScenes.length} {filterScenes.length === 1 ? 'escena' : 'escenas'}</Text>
        <View style={ui.card}><Icon name={listenModeSelection === 'manual' ? 'gesture-tap' : 'microphone-outline'} size={32} /><Text style={ui.subtitle}>{listenModeSelection === 'intelligent' ? 'Modo inteligente' : listenModeSelection === 'auto' ? 'Avance al terminar de hablar' : 'Modo manual'}</Text><Text style={ui.text}>{listenModeSelection === 'intelligent' ? 'La app interpreta los demás personajes y comprueba tus palabras cuando llega tu turno.' : listenModeSelection === 'auto' ? 'Prepararemos el micro para avanzar cuando termines tu réplica y guardes silencio.' : 'La app interpreta los demás personajes. Pulsa siguiente al terminar tu réplica.'}</Text></View>
        <Text style={ui.text}>Antes de cada ensayo comprobaremos el altavoz y prepararemos el micrófono.</Text>
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
            <Text style={styles.preflightTitle}>Abriendo la escucha…</Text>
            <Text style={styles.preflightText}>
              Si aparece una solicitud del navegador para reconocer tu voz, pulsa Permitir. Después comprobaremos la voz de la app con el micrófono abierto.
            </Text>
          </> : null}
          {renderRecognitionError(enableIntelligentListenForDevice, 'Reintentar inicio')}
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
        <Text style={styles.intelligentLabel}>
          {isPaused ? 'Ensayo en pausa' : speechRecognitionStatus === 'error'
            ? 'La escucha necesita tu atención'
            : isRecognitionAudioActive
              ? 'Micrófono abierto. Puedes hablar.'
              : speechRecognitionStatus === 'starting'
                ? 'Abriendo el micrófono…'
                : 'Esperando la entrada del micrófono'}
        </Text>
        {renderRecognitionError(handleRetryIntelligentLine, 'Activar micrófono')}
        {!isPaused && !speechRecognitionError && !isRecognitionAudioActive ? <TouchableOpacity
          accessibilityRole="button"
          style={[styles.intelligentButton, styles.intelligentRetryButton]}
          onPress={handleRetryIntelligentLine}
          accessibilityLabel={hasTranscript ? 'Reiniciar escucha' : 'Activar micrófono'}
        >
          <Text style={styles.intelligentRetryText}>
            {hasTranscript ? 'Reiniciar escucha' : 'Activar micrófono'}
          </Text>
        </TouchableOpacity> : null}
        {showTranscript ? <View testID="rehearsal-transcript" style={{ gap: 6, marginTop: 10 }}>
          <Text style={ui.label}>HE OÍDO</Text>
          <Text style={[ui.text, { color: palette.ink }]}>{speechRecognitionTranscript || 'Tu transcripción aparecerá aquí…'}</Text>
        </View> : null}
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
        </> : null}
      </View>
    );
  };

  if (!isRehearsalMediaReady) {
    const isDuplexCheck = rehearsalPreflightPhase === 'recognition-audio-check';
    const isCalibrating = rehearsalPreflightPhase === 'micro-calibration';
    const isReadyToListen = rehearsalPreflightPhase === 'ready-to-listen';
    const isReadyToStart = rehearsalPreflightPhase === 'ready-to-start';
    return <View style={styles.container}>
      {renderHeader(listenModeSelection === 'manual' ? 'Preparar altavoz' : 'Preparar audio y micrófono')}
      <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">
        <View style={ui.wrap}>{[listenModeSelection === 'manual' ? 'Sin micro' : `${microphoneCalibrated ? '✓' : '1'} Micro`, `${speakerConfirmed ? '✓' : listenModeSelection === 'manual' ? '1' : '2'} Altavoz`, '3 Ensayo'].map((label) => <View key={label} style={[ui.chip, { backgroundColor: palette.soft }]}><Text style={[ui.chipText, { color: palette.plum }]}>{label}</Text></View>)}</View>
        <View style={ui.card}>
          <Icon name={isCalibrating || isReadyToListen ? 'microphone-outline' : 'volume-high'} size={34} />
          <Text style={ui.title}>{isCalibrating ? 'Calibrar micrófono' : isReadyToListen ? 'Activar la escucha' : isReadyToStart ? 'Todo preparado' : isDuplexCheck ? 'Última prueba de voz' : '¿Oyes a la app?'}</Text>
          <Text style={ui.text}>{isCalibrating ? 'Guarda silencio. Cuando aparezca «Habla ahora», di «prueba de micro».' : isReadyToListen ? 'La calibración ya está hecha. Ahora abriremos el reconocimiento de palabras.' : isDuplexCheck ? 'Comprueba que oyes a la app también con el reconocimiento abierto.' : isReadyToStart ? listenModeSelection === 'manual' ? 'El altavoz está preparado. Ensayarás sin activar el micrófono.' : 'El altavoz y el micrófono ya están comprobados.' : 'Sube el volumen y escucha la frase. No entraremos al ensayo hasta que confirmes que la oyes.'}</Text>
          {rehearsalMediaStatus ? <Text accessibilityLiveRegion="polite" style={[ui.text, { color: palette.plum }]}>{rehearsalMediaStatus}</Text> : null}
          {isCalibrating ? <>
            <View style={styles.microCalibrationMeterTrack}><View style={[styles.microCalibrationMeterFill, { width: `${Math.max(4, Math.round(signalLevel * 100))}%`, backgroundColor: palette.plum }]} /></View>
            <Text style={ui.text}>Nivel de entrada: {Math.round(rawLevel * 100)}% · {Math.round(microphoneCalibrationProgress * 100)}%</Text>
            {listeningError ? <Text style={ui.error}>{listeningError}</Text> : null}
            <Button label={isPreparingRehearsalMedia ? 'Calibrando…' : 'Reintentar calibración'} disabled={isPreparingRehearsalMedia} onPress={() => void calibrateRehearsalMicrophone()} />
          </> : isReadyToListen ? <Button label="Comprobar escucha" onPress={enableIntelligentListenForDevice} />
            : isReadyToStart ? <Button label="Empezar ensayo" onPress={() => finishRehearsalPreparation()} />
            : <>
              <Button label={isPreparingRehearsalMedia ? 'Reproduciendo prueba…' : hasPreparedRehearsalMedia ? 'Repetir prueba de voz' : 'Probar voz'} disabled={isPreparingRehearsalMedia} secondary onPress={() => prepareRehearsalMedia(isDuplexCheck)} />
              {hasPreparedRehearsalMedia ? <Button label={isDuplexCheck ? 'Sí, la oigo. Empezar ensayo' : 'Sí, la oigo. Continuar'} onPress={() => {
                if (isDuplexCheck) finishRehearsalPreparation(true);
                else { setSpeakerConfirmed(true); setRehearsalPreflightPhase(listenModeSelection === 'intelligent' ? 'ready-to-listen' : 'ready-to-start'); setRehearsalMediaStatus(null); }
              }} /> : null}
              {isDuplexCheck ? renderRecognitionError(enableIntelligentListenForDevice, 'Reintentar escucha') : null}
              {isDuplexCheck && !isRecognitionAudioActive && !speechRecognitionError ? <Button label="Reabrir escucha" secondary onPress={enableIntelligentListenForDevice} /> : null}
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
          <Button label="Empezar esta escena" onPress={advanceLine} />
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
            {currentLine.a ? <Text style={styles.acot}>[{currentLine.a}]</Text> : null}

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
            if (listenModeSelection === 'intelligent') activateRecognition({ lang: intelligentRecognitionLanguage, lineKey: recognitionLineKey || recognitionPreparationKey });
            setIsPaused(false);
          } else {
            setIsPaused(true); stopRehearsalSpeech(); stopStandaloneSongAudio(); stopRecognition(); void releaseListening();
          }
        }} style={[ui.button, ui.row, { minWidth: 140 }]}><Icon name={isPaused ? 'play' : 'pause'} color="#fff" /><Text style={ui.buttonText}>{isPaused ? 'Reanudar' : 'Pausa'}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Siguiente línea" onPress={advanceLine} style={ui.icon}><Icon name="skip-next" size={28} /></TouchableOpacity>
      </View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bg },
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
    backgroundColor: palette.surface,
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
  acot: { fontStyle: 'italic', color: '#666', marginBottom: 15 },
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
