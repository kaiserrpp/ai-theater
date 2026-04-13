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

export interface SharedScriptManifest {
  version: number;
  shareId: string;
  fileName: string;
  scriptData: ScriptData;
  mergeMap: CharacterMergeMap;
  songs: SharedSongAsset[];
  createdAt: string;
  updatedAt: string;
}

export interface SharedScriptListItem {
  shareId: string;
  obra: string;
  fileName: string;
  mergeCount: number;
  songCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SharedScriptPublishInput {
  shareId?: string | null;
  fileName: string;
  scriptData: ScriptData;
  mergeMap: CharacterMergeMap;
  songs?: SharedSongAsset[];
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
