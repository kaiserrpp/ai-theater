export const SCENE_SYSTEM_SPEAKER = 'ESCENA_SISTEMA';
export const SONG_SYSTEM_SPEAKER = 'CANCION_SISTEMA';

export type ScriptLineKind = 'dialogue' | 'song';

export interface Dialogue {
  p: string;
  t: string;
  a?: string;
  k?: ScriptLineKind;
  songTitle?: string;
}

export interface ScriptData {
  obra: string;
  personajes: string[];
  guion: Dialogue[];
}

export interface SceneExtractionResult {
  obra?: string;
  personajes?: string[];
  guion?: Dialogue[];
}

export interface PendingAnalysisJob {
  data: ScriptData;
  fileUri: string;
  index: number;
  totalChunks: string[];
}
