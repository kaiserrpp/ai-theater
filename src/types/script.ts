export const SCENE_SYSTEM_SPEAKER = 'ESCENA_SISTEMA';

export interface Dialogue {
  p: string;
  t: string;
  a?: string;
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
