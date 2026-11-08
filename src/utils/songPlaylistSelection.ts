import type { PlaybackTrack } from './songPlayback';

export type SongPlaylistKind = 'all' | 'vocal_guide' | 'karaoke';
interface LibraryTrack extends PlaybackTrack { auditionId?: string; audio: PlaybackTrack['audio'] & { kind: 'vocal_guide' | 'karaoke' }; }

export const selectSongPlaylist = <T extends LibraryTrack>(tracks: T[], options: {
  scope: 'auditions' | 'work'; kind: SongPlaylistKind; visibleAuditionIds: string[];
}) => {
  const visible = new Set(options.visibleAuditionIds);
  return tracks.filter((track) => (options.scope === 'work' ? !track.auditionId : Boolean(track.auditionId && visible.has(track.auditionId)))
    && (options.kind === 'all' || track.audio.kind === options.kind));
};
