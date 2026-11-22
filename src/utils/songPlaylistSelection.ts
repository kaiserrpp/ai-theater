import type { PlaybackTrack } from './songPlayback';
import { CHOIR_PARTS, normalizeChoirPart, type ChoirPart } from '../../shared/choirParts';

export type SongPlaylistKind = 'all' | 'vocal_guide' | 'karaoke';
export type ChoirPreference = 'warmup' | 'each-song' | ChoirPart | `warmup:${ChoirPart}`;

export const usesWarmupVoice = (preference: ChoirPreference) =>
  preference === 'warmup' || preference.startsWith('warmup:');

export const restoreChoirPreference = (stored: string | null): ChoirPreference => {
  if (stored === '' || stored === 'each-song') return 'each-song';
  const storedPart = normalizeChoirPart(stored);
  if (storedPart) return storedPart;
  if (stored?.startsWith('warmup:')) {
    const subdivision = normalizeChoirPart(stored.slice('warmup:'.length));
    if (subdivision?.includes('-')) return `warmup:${subdivision}`;
  }
  return 'warmup';
};

export const resolveChoirPart = (preference: ChoirPreference, warmupVoice: string): ChoirPart | null => {
  if (!usesWarmupVoice(preference)) return normalizeChoirPart(preference);
  const subdivision = normalizeChoirPart(preference.slice('warmup:'.length));
  return subdivision?.startsWith(`${warmupVoice}-`) ? subdivision : normalizeChoirPart(warmupVoice);
};

interface LibraryTrack extends PlaybackTrack {
  auditionId?: string;
  musicalNumberId?: string;
  audio: PlaybackTrack['audio'] & { kind: 'vocal_guide' | 'karaoke'; choirPart?: ChoirPart };
}

export const selectSongPlaylist = <T extends LibraryTrack>(tracks: T[], options: {
  scope: 'auditions' | 'work'; kind: SongPlaylistKind; visibleAuditionIds: string[];
}) => {
  const visible = new Set(options.visibleAuditionIds);
  return tracks.filter((track) => (options.scope === 'work'
    ? !track.auditionId && !track.audio.choirPart
    : Boolean(track.auditionId && visible.has(track.auditionId)))
    && (options.kind === 'all' || track.audio.kind === options.kind));
};

export const groupChoirTracks = <T extends LibraryTrack>(tracks: T[]) => {
  const groups = new Map<string, T[]>();
  for (const track of tracks) {
    if (track.auditionId || !track.musicalNumberId || !track.audio.choirPart) continue;
    const group = groups.get(track.musicalNumberId);
    if (group) group.push(track);
    else groups.set(track.musicalNumberId, [track]);
  }
  return Array.from(groups, ([id, versions]) => ({
    id,
    versions: versions.sort((left, right) => CHOIR_PARTS.indexOf(left.audio.choirPart!) - CHOIR_PARTS.indexOf(right.audio.choirPart!)),
  }));
};

export const selectChoirTrack = <T extends LibraryTrack>(versions: T[], part: ChoirPart | null): T | undefined => {
  if (!part) return undefined;
  const [family] = part.split('-');
  return versions.find((track) => track.audio.choirPart === part)
    ?? versions.find((track) => track.audio.choirPart === family);
};
