export interface RecognitionSessionDiagnostics {
  kind: 'recognition_session'; elapsedMs: number; status: string;
  startCount: number; audioStartCount: number; textEventCount: number; endCount: number;
  retryCount: number; noSpeechCount: number;
  firstServiceStartMs: number | null; firstAudioStartMs: number | null; firstTextMs: number | null;
  currentTranscriptEmpty: boolean; inputActive: boolean; inputAlreadyActive: boolean;
  errors: { code: string; atMs: number }[];
}
export function normalizeRecognitionSessionDiagnostics(value: unknown): RecognitionSessionDiagnostics | null;
