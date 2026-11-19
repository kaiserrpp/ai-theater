import type { MusicalAuditionDetailsInput, SharedMusicalAudition, SharedScriptManifest, SharedSongAudioAsset, SharedSongAudioKind } from '../types/sharedScript';
import type { SharedSongUploadResult } from '../api/sharedSongUploads';

export interface AuditionAudioReference { id: string; kind: SharedSongAudioKind; }
export interface PendingAuditionAudio extends AuditionAudioReference { label: string; file?: File; audio?: SharedSongAudioAsset; }

export const auditionAudioLabel = (audio: Pick<SharedSongAudioAsset, 'kind' | 'label'>) => {
  const kind = audio.kind === 'karaoke' ? 'Karaoke' : 'Con voz';
  return ['Karaoke', 'Con voz', 'Vocal guide'].includes(audio.label) ? kind : `${kind} · ${audio.label}`;
};

// Metadata is committed first. Each completed audio is acknowledged separately,
// so retrying a failed second upload never duplicates the fragment or first file.
export const performMusicalAuditionSave = async (input: MusicalAuditionDetailsInput, files: PendingAuditionAudio[], removals: AuditionAudioReference[], operations: {
  saveDetails: (input: MusicalAuditionDetailsInput) => Promise<SharedScriptManifest>;
  upload: (file: File, kind: SharedSongAudioKind) => Promise<SharedSongUploadResult>;
  saveAudio: (cut: SharedMusicalAudition, pending: PendingAuditionAudio, uploaded: Pick<SharedSongUploadResult, 'url' | 'fileName' | 'contentType' | 'size'>) => Promise<SharedScriptManifest>;
  removeAudio: (cut: SharedMusicalAudition, reference: AuditionAudioReference) => Promise<SharedScriptManifest>;
  onCommitted: (manifest: SharedScriptManifest, cut: SharedMusicalAudition) => void;
  onFileCommitted: (id: string) => void;
  uploadedFiles: Map<File, SharedSongUploadResult>;
}) => {
  let manifest = await operations.saveDetails(input);
  const resolveCut = () => {
    const cut = manifest.musicalAuditions.find((candidate) => candidate.id === input.auditionId);
    if (!cut) throw new Error('El fragmento guardado no aparece en la obra. Actualiza las canciones.');
    operations.onCommitted(manifest, cut);
    return cut;
  };
  let cut = resolveCut();
  for (const reference of removals) {
    manifest = await operations.removeAudio(cut, reference); cut = resolveCut();
  }
  for (const pending of files) {
    let uploaded = pending.file ? operations.uploadedFiles.get(pending.file) : pending.audio ? {
      url: pending.audio.audioUrl, fileName: pending.audio.audioFileName, contentType: pending.audio.contentType, size: pending.audio.size,
    } : null;
    if (!uploaded && pending.file) {
      const result = await operations.upload(pending.file, pending.kind);
      operations.uploadedFiles.set(pending.file, result);
      uploaded = result;
    }
    if (!uploaded) continue;
    manifest = await operations.saveAudio(cut, pending, uploaded);
    cut = resolveCut();
    operations.onFileCommitted(pending.id);
  }
  return manifest;
};

const AUDIO_MIME_TYPES: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', aif: 'audio/aiff', aiff: 'audio/aiff' };
const VIDEO_MIME_TYPES: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', '3gp': 'video/3gpp' };
export const AUDITION_MEDIA_PICKER_TYPES = ['audio/*', 'video/*', ...Object.keys(AUDIO_MIME_TYPES).map((extension) => `.${extension}`), ...Object.keys(VIDEO_MIME_TYPES).map((extension) => `.${extension}`)];

export const resolveAuditionMediaMimeType = (name: string, type: string) => {
  const normalizedType = type.trim().toLowerCase();
  if (/^(audio|video)\//.test(normalizedType)) return normalizedType;
  const extension = name.split('.').pop()?.toLowerCase() || '';
  return AUDIO_MIME_TYPES[extension] || VIDEO_MIME_TYPES[extension] || null;
};
export const resolveAuditionAudioMimeType = (name: string, type: string) => {
  const mime = resolveAuditionMediaMimeType(name, type);
  return mime?.startsWith('audio/') ? mime : null;
};

// Keep a successfully uploaded video through conversion retries. The enclosing
// save operation separately caches the extracted audio until registration succeeds.
export const prepareAuditionMedia = async (file: File, operations: {
  sourceUploads: Map<File, SharedSongUploadResult>;
  upload: (file: File) => Promise<SharedSongUploadResult>;
  extract: (source: SharedSongUploadResult) => Promise<SharedSongUploadResult>;
  onExtracting: () => void;
}) => {
  let source = operations.sourceUploads.get(file);
  if (!source) {
    source = await operations.upload(file);
    operations.sourceUploads.set(file, source);
  }
  if (!file.type.startsWith('video/')) return source;
  operations.onExtracting();
  const audio = await operations.extract(source);
  operations.sourceUploads.delete(file);
  return audio;
};
