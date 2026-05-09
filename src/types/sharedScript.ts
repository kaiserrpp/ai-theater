import { ScriptData } from './script';
import type { CharacterMergeMap } from '../utils/scriptRoleMerges';

export type SharedSongAudioKind = 'karaoke' | 'vocal_guide';

export interface SharedSongAudioAsset {
  id: string;
  label: string;
  kind: SharedSongAudioKind;
  guideRoles: string[];
  audioUrl: string;
  audioFileName: string | null;
  contentType: string | null;
  size: number | null;
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
  createdAt: string;
  updatedAt: string;
}

export interface SharedScriptListItem {
  shareId: string;
  obra: string;
  fileName: string;
  mergeCount: number;
  songCount: number;
  musicalNumberCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SharedScriptPublishInput {
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
  password: string;
  label: string;
  kind: SharedSongAudioKind;
  guideRoles: string[];
  audioUrl: string;
  audioFileName?: string | null;
  contentType?: string | null;
  size?: number | null;
}

export interface SharedSongAudioUpdateInput {
  shareId: string;
  songId: string;
  audioId: string;
  password: string;
  label: string;
  kind: SharedSongAudioKind;
  guideRoles: string[];
  audioUrl?: string | null;
  audioFileName?: string | null;
  contentType?: string | null;
  size?: number | null;
}

export interface SharedSongAudioDeleteInput {
  shareId: string;
  songId: string;
  audioId: string;
  password: string;
}

export interface SharedMusicalNumberCreateInput {
  shareId: string;
  password: string;
  title: string;
  sceneTitle: string;
  startLineIndex: number;
  endLineIndex: number;
}

export interface SharedMusicalNumberUpdateInput {
  shareId: string;
  musicalNumberId: string;
  password: string;
  title: string;
  sceneTitle: string;
  startLineIndex: number;
  endLineIndex: number;
}

export interface SharedMusicalNumberDeleteInput {
  shareId: string;
  musicalNumberId: string;
  password: string;
}

export interface SharedMusicalNumberAudioRegistrationInput {
  shareId: string;
  musicalNumberId: string;
  musicalNumberTitle?: string;
  sceneTitle?: string | null;
  startLineIndex?: number;
  endLineIndex?: number;
  songIds?: string[];
  password: string;
  label: string;
  kind: SharedSongAudioKind;
  guideRoles: string[];
  audioUrl: string;
  audioFileName?: string | null;
  contentType?: string | null;
  size?: number | null;
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
  password: string;
  label: string;
  kind: SharedSongAudioKind;
  guideRoles: string[];
  audioUrl?: string | null;
  audioFileName?: string | null;
  contentType?: string | null;
  size?: number | null;
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
  password: string;
}

export type IntelligentLineFeedbackResult =
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

export interface IntelligentLineFeedbackEntry {
  lineIndex: number;
  character: string;
  sceneTitle: string | null;
  expectedText: string;
  heardText: string;
  score: number;
  result: IntelligentLineFeedbackResult;
  matchedReferenceText: string;
  matchedReferenceIndex: number;
  language: string;
  issueType?: IntelligentLineFeedbackIssueType | null;
  issueNote?: string | null;
  createdAt: string;
}

export interface IntelligentLineFeedbackSessionInput {
  sessionId: string;
  scriptId: string;
  shareId?: string | null;
  scriptTitle: string;
  appVersion: string;
  userRoles: string[];
  userAgent?: string | null;
  entries: IntelligentLineFeedbackEntry[];
}
