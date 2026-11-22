import type { PlaybackTrack } from './songPlayback';
import { CHOIR_PARTS, type ChoirPart } from '../../shared/choirParts';

export type SongPlaylistKind = 'all' | 'vocal_guide' | 'karaoke';
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
