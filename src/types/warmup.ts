export interface PreparedWarmupAudio {
  audioUrl: string;
  durationSeconds: number;
}

export interface WarmupExercise {
  id: string;
  title: string;
  objective: string;
  instructions: string;
  sourceStart: number;
  sourceEnd: number;
  advice: { text: string; sourceAt: number }[];
  uncertainties: string[];
  score: {
    description: string;
    progressionDescription: string;
    entranceNotes: number[];
    closingNotes: number[];
    offsets: number[];
    noteBeats: number[];
    tempoBpm: number;
    preparationBeats: number;
    closingBeats: number;
    sourceRoot: number;
    startOffset: number;
    progression: { offset: number; repetitions: number }[];
  };
  explanation: PreparedWarmupAudio;
  piano: Record<string, PreparedWarmupAudio>;
  cues: { beforeStep: number; text: string; sourceAt: number; audio: PreparedWarmupAudio }[];
}

export interface WarmupCatalog {
  version: 1;
  id: string;
  title: string;
  status: 'pilot' | 'complete';
  source: { durationSeconds: number; sha256: string };
  exercises: WarmupExercise[];
  pending: { title: string; sourceStart: number; sourceEnd: number; note: string }[];
  credits: { label: string; url: string }[];
}

export interface WarmupPreferences {
  voice: string;
  low: number;
  high: number;
  exercises: Record<string, { start?: number; low?: number; high?: number }>;
}

export interface WarmupTrack {
  key: string;
  title: string;
  exerciseId: string;
  phase: 'explanation' | 'piano' | 'tip';
  audio: PreparedWarmupAudio;
  root?: number;
}
