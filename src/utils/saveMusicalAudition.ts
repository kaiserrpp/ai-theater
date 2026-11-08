import type { MusicalAuditionDetailsInput, SharedMusicalAudition, SharedScriptManifest, SharedSongAudioKind } from '../types/sharedScript';
import type { SharedSongUploadResult } from '../api/sharedSongUploads';

export interface PendingAuditionAudio { kind: SharedSongAudioKind; file: File; }

// Metadata is committed first. Each completed audio is acknowledged separately,
// so retrying a failed second upload never duplicates the fragment or first file.
export const performMusicalAuditionSave = async (input: MusicalAuditionDetailsInput, files: PendingAuditionAudio[], removeKinds: SharedSongAudioKind[], operations: {
  saveDetails: (input: MusicalAuditionDetailsInput) => Promise<SharedScriptManifest>;
  upload: (file: File, kind: SharedSongAudioKind) => Promise<SharedSongUploadResult>;
  saveAudio: (cut: SharedMusicalAudition, kind: SharedSongAudioKind, uploaded: SharedSongUploadResult) => Promise<SharedScriptManifest>;
  removeAudio: (cut: SharedMusicalAudition, kind: SharedSongAudioKind) => Promise<SharedScriptManifest>;
  onCommitted: (manifest: SharedScriptManifest, cut: SharedMusicalAudition) => void;
  onFileCommitted: (kind: SharedSongAudioKind) => void;
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
  for (const kind of removeKinds) {
    manifest = await operations.removeAudio(cut, kind); cut = resolveCut();
  }
  for (const pending of files) {
    let uploaded = operations.uploadedFiles.get(pending.file);
    if (!uploaded) {
      uploaded = await operations.upload(pending.file, pending.kind);
      operations.uploadedFiles.set(pending.file, uploaded);
    }
    manifest = await operations.saveAudio(cut, pending.kind, uploaded);
    cut = resolveCut();
    operations.onFileCommitted(pending.kind);
  }
  return manifest;
};

const AUDIO_MIME_TYPES: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', aif: 'audio/aiff', aiff: 'audio/aiff', webm: 'audio/webm' };
export const resolveAuditionAudioMimeType = (name: string, type: string) => {
  if (type.startsWith('audio/')) return type;
  return AUDIO_MIME_TYPES[name.split('.').pop()?.toLowerCase() || ''] || null;
};
