import { ScriptData } from './script';
import type { CharacterMergeMap } from '../utils/scriptRoleMerges';

export interface SharedSongAsset {
  id: string;
  title: string;
  audioUrl: string | null;
  audioFileName?: string | null;
  updatedAt: string;
}

export interface SharedScriptManifest {
  version: 1;
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
