export interface SharedSongUploadResult {
  url: string;
  pathname: string;
  fileName: string | null;
  contentType: string | null;
  size: number | null;
}

interface UploadSharedSongAudioInput {
  shareId: string;
  targetId: string;
  targetType?: 'song' | 'musical-number';
  file: Blob;
  password: string;
  onUploadProgress?: (percentage: number) => void;
}

interface ExtractSharedSongVideoAudioInput {
  shareId: string;
  targetId: string;
  targetType?: 'song' | 'musical-number';
  password: string;
  sourceUrl: string;
  sourcePathname?: string | null;
  sourceFileName?: string | null;
  sourceContentType?: string | null;
}

export const uploadSharedSongAudio = async (_input: UploadSharedSongAudioInput): Promise<SharedSongUploadResult> => {
  throw new Error('La subida de canciones solo esta disponible en la app web por ahora.');
};

export const extractSharedSongAudioFromVideo = async (
  _input: ExtractSharedSongVideoAudioInput
): Promise<SharedSongUploadResult> => {
  throw new Error('La extraccion server-side de audio desde video solo esta disponible en la app web por ahora.');
};
