import { ScriptData } from './script';
import type { CharacterMergeMap } from '../utils/scriptRoleMerges';
import type { SharedWorkAppearance } from '../../shared/workAppearance';

export type SharedSongAudioKind = 'karaoke' | 'vocal_guide';
export type MusicalTimelineCueTargetKind = 'dialogue' | 'song';

export interface MusicalTimelineCue {
  id: string;
  atMs: number;
  targetLineIndex: number;
  targetKind: MusicalTimelineCueTargetKind;
}

export interface SharedSongAudioAsset {
  id: string;
  label: string;
  kind: SharedSongAudioKind;
  guideRoles: string[];
  audioUrl: string;
  audioFileName: string | null;
  contentType: string | null;
  size: number | null;
  timelineCues: MusicalTimelineCue[];
  updatedAt: string;
}

export interface SharedSongAsset {
  id: string;
  title: string;
  lineIndex: number;
  sceneTitle: string | null;
  lyrics: string;
  audios: SharedSongAudioAsset[];
  updatedAt: string;
}

export interface SharedMusicalNumberAsset {
  id: string;
  title: string;
  sceneTitle: string | null;
  startLineIndex: number;
  endLineIndex: number;
  songIds: string[];
  audios: SharedSongAudioAsset[];
  updatedAt: string;
}

export interface SharedScriptManifest {
  version: number;
  shareId: string;
  fileName: string;
  scriptData: ScriptData;
  mergeMap: CharacterMergeMap;
  songs: SharedSongAsset[];
  musicalNumbers: SharedMusicalNumberAsset[];
  auditionScenes: SharedAuditionScene[];
  musicalAuditions: SharedMusicalAudition[];
  appearance?: SharedWorkAppearance;
  createdAt: string;
  updatedAt: string;
}

export interface SharedMusicalAudition {
  id: string;
  musicalNumberId: string;
  title: string;
  roles: string[];
  lyrics: string;
  audios: SharedSongAudioAsset[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface MusicalAuditionDetailsInput {
  shareId: string; password?: string; auditionId: string; revision?: number;
  musicalNumberId?: string; musicalNumberTitle?: string;
  title: string; roles: string[]; lyrics: string;
}

export interface SharedAuditionScene {
  id: string;
  title: string;
  fileName: string | null;
  scriptData: ScriptData;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SharedAuditionSceneInput {
  shareId: string;
  password?: string;
  sceneId?: string;
  revision?: number;
  title: string;
  fileName: string | null;
  scriptData: ScriptData;
}

export interface SharedScriptListItem {
  shareId: string;
  obra: string;
  fileName: string;
  mergeCount: number;
  songCount: number;
  musicalNumberCount?: number;
  auditionSceneCount?: number;
  musicalAuditionCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SharedScriptPublishInput {
  password?: string;
  shareId?: string | null;
  fileName: string;
  scriptData: ScriptData;
  mergeMap: CharacterMergeMap;
  songs?: SharedSongAsset[];
  musicalNumbers?: SharedMusicalNumberAsset[];
}

export interface SharedSongAudioRegistrationInput {
  shareId: string;
  songId: string;
  password?: string;
  label: string;
  kind: SharedSongAudioKind;
  guideRoles: string[];
  audioUrl: string;
  audioFileName?: string | null;
  contentType?: string | null;
  size?: number | null;
  timelineCues?: MusicalTimelineCue[];
}

export interface SharedSongAudioUpdateInput {
  shareId: string;
  songId: string;
  audioId: string;
  password?: string;
  label: string;
  kind: SharedSongAudioKind;
  guideRoles: string[];
  audioUrl?: string | null;
  audioFileName?: string | null;
  contentType?: string | null;
  size?: number | null;
  timelineCues?: MusicalTimelineCue[];
}

export interface SharedSongAudioDeleteInput {
  shareId: string;
  songId: string;
  audioId: string;
  password?: string;
}

export interface SharedMusicalNumberCreateInput {
  shareId: string;
  password?: string;
  title: string;
  sceneTitle: string;
  startLineIndex: number;
  endLineIndex: number;
}

export interface SharedMusicalNumberUpdateInput {
  shareId: string;
  musicalNumberId: string;
  password?: string;
  title: string;
  sceneTitle: string;
  startLineIndex: number;
  endLineIndex: number;
}

export interface SharedMusicalNumberDeleteInput {
  shareId: string;
  musicalNumberId: string;
  password?: string;
}

export interface SharedMusicalNumberAudioRegistrationInput {
  shareId: string;
  musicalNumberId: string;
  musicalNumberTitle?: string;
  sceneTitle?: string | null;
  startLineIndex?: number;
  endLineIndex?: number;
  songIds?: string[];
  password?: string;
  label: string;
  kind: SharedSongAudioKind;
  guideRoles: string[];
  audioUrl: string;
  audioFileName?: string | null;
  contentType?: string | null;
  size?: number | null;
  timelineCues?: MusicalTimelineCue[];
}

export interface SharedMusicalNumberAudioUpdateInput {
  shareId: string;
  musicalNumberId: string;
  musicalNumberTitle?: string;
  sceneTitle?: string | null;
  startLineIndex?: number;
  endLineIndex?: number;
  songIds?: string[];
  audioId: string;
  password?: string;
  label: string;
  kind: SharedSongAudioKind;
  guideRoles: string[];
  audioUrl?: string | null;
  audioFileName?: string | null;
  contentType?: string | null;
  size?: number | null;
  timelineCues?: MusicalTimelineCue[];
}

export interface SharedMusicalNumberAudioDeleteInput {
  shareId: string;
  musicalNumberId: string;
  musicalNumberTitle?: string;
  sceneTitle?: string | null;
  startLineIndex?: number;
  endLineIndex?: number;
  songIds?: string[];
  audioId: string;
  password?: string;
}

export type IntelligentLineFeedbackResult =
  | 'informe_parcial'
  | 'comparacion_ensayo'
  | 'comparacion_local'
  | 'linea_buena'
  | 'reintentar'
  | 'siguiente_linea'
  | 'comando_siguiente'
  | 'auto_avance'
  | 'falso_positivo';

export type IntelligentLineFeedbackIssueType =
  | 'corto_antes_de_tiempo'
  | 'dije_mal_mi_frase'
  | 'otro';

export interface RecognitionProcessingTiming {
  kind: 'live_processing';
  requestToTextMs: number;
  processingMs: number;
  queueMs: number;
  audioDurationMs: number;
  encoderDevice?: 'webgpu' | 'wasm';
  decoderDevice?: 'wasm';
  encoderDtype?: 'fp32' | 'q8';
  fallbackReason?: string | null;
  segmentFinalization?: 'speech_gap' | 'window_limit' | 'speech_resume' | 'input_end';
  trailingQuietMs?: number;
  segmentationThreshold?: number;
}

export interface RehearsalResponseTiming {
  kind: 'browser_events';
  origin?: 'native_bridge';
  matchToVoiceRequestMs: number;
  matchToVoiceStartEventMs: number;
  inputCloseMs: number;
  voiceRequestToStartEventMs: number;
}

export interface RecognitionComparisonTiming {
  firstTextMs: number | null;
  acceptedAtMs: number | null;
  decisionText: string | null;
  speechEndMs: number | null;
  speechEndKind: 'sample_rms_estimate' | 'browser_speechend_event' | null;
  decisionAfterSpeechMs: number | null;
  maxFeedLagMs?: number | null;
  inputEndMs?: number | null;
  inputEndSignal?: 'audioend' | 'end' | null;
  matchToInputEndMs?: number | null;
  serviceEndMs?: number | null;
  replayMs?: number | null;
  startMs?: number | null;
  endWaitMs?: number | null;
  events: { atMs: number | null; audioMs: number | null; text: string | null; interim: boolean }[];
}

export interface IntelligentLineFeedbackEntry {
  recognitionEngine?: 'native' | 'vosk' | 'whisper' | 'comparison';
  rehearsalComparison?: {
    id: string; execution: 'parallel'; sameUtterance: true;
    completion: 'speech_end' | 'button' | 'manual' | 'exit' | 'capture_failed' | 'report_snapshot'; elapsedMs: number; quietMs: number;
    speechStartMs: number | null; speechEndMs: number | null; inputClosedMs: number | null;
    speechTimingSource: 'shared_capture_rms' | 'native_result_event';
    results: (import('../utils/rehearsalComparisonSession').ComparisonEngineResult & {
      score: number; coverageScore: number; orderScore: number; precisionScore: number; finalScore: number;
    })[];
  };
  scriptContextEnabled?: boolean;
  scriptContextTermCount?: number;
  recognitionTiming?: RecognitionProcessingTiming | null;
  responseTiming?: RehearsalResponseTiming | null;
  recognitionComparison?: {
    sampleId: string | null; engine: 'native' | 'vosk' | 'whisper'; status: 'done' | 'error';
    comparisonId?: string | null; sameAudioPair?: boolean;
    replay?: RecognitionComparisonTiming | null; native?: RecognitionComparisonTiming | null;
    model: string | null; modelRevision: string | null; backend: 'wasm' | 'webgpu' | 'browser';
    languageUsed: 'english' | 'spanish' | null;
    contextUsed?: boolean; contextTermCount?: number; contextPrompt?: string | null;
    sampleDurationMs: number | null; loadMs: number | null; processingMs: number | null;
    accepted: boolean; literalDifference: number | null; verdict: 'correct' | 'incorrect' | null;
    error: string | null; order: string | null; timingKind: 'offline_processing' | 'paced_replay' | 'native_live'; audioUploaded: false;
  };
  lineIndex: number;
  character: string;
  sceneTitle: string | null;
  expectedText: string;
  heardText: string;
  score: number;
  coverageScore?: number;
  orderScore?: number;
  finalScore?: number;
  finalPhraseScore?: number;
  finalPhraseWordCount?: number;
  precisionScore?: number;
  negationPenaltyApplied?: boolean;
  autoAdvanceReason?: string | null;
  result: IntelligentLineFeedbackResult;
  matchedReferenceText: string;
  matchedReferenceIndex: number;
  language: string;
  issueType?: IntelligentLineFeedbackIssueType | null;
  issueNote?: string | null;
  createdAt: string;
}

export interface IntelligentLineFeedbackSessionInput {
  runtime?: 'browser' | 'native_ios' | 'native_android';
  nativeAppVersion?: string;
  sessionId: string;
  scriptId: string;
  shareId?: string | null;
  scriptTitle: string;
  appVersion: string;
  userRoles: string[];
  userAgent?: string | null;
  entries: IntelligentLineFeedbackEntry[];
}
