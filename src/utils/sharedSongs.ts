import { Dialogue } from '../types/script';
import {
  SharedMusicalNumberAsset,
  SharedSongAsset,
  SharedSongAudioAsset,
  SharedSongAudioKind,
} from '../types/sharedScript';
import { isSceneMarker, isSongCue } from './scriptScenes';

const DEFAULT_SONG_TITLE = 'Cancion';

const sanitizeSlug = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const normalizeGuideRoles = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.filter((role): role is string => typeof role === 'string' && role.trim().length > 0))
  );
};

const normalizeSongAudioKind = (value: unknown): SharedSongAudioKind =>
  value === 'vocal_guide' ? 'vocal_guide' : 'karaoke';

const normalizeSongAudios = (song: unknown): SharedSongAudioAsset[] => {
  if (!song || typeof song !== 'object') {
    return [];
  }

  const candidate = song as Partial<SharedSongAsset> & {
    audioUrl?: unknown;
    audioFileName?: unknown;
    audios?: unknown;
  };

  if (Array.isArray(candidate.audios)) {
    return candidate.audios
      .filter((audio): audio is SharedSongAudioAsset => Boolean(audio) && typeof audio === 'object')
      .map((audio, index) => ({
        id:
          typeof audio.id === 'string' && audio.id.trim().length > 0
            ? audio.id
            : `audio-${index + 1}`,
        label:
          typeof audio.label === 'string' && audio.label.trim().length > 0
            ? audio.label.trim()
            : normalizeSongAudioKind(audio.kind) === 'vocal_guide'
              ? 'Vocal guide'
              : 'Karaoke',
        kind: normalizeSongAudioKind(audio.kind),
        guideRoles: normalizeGuideRoles(audio.guideRoles),
        audioUrl: typeof audio.audioUrl === 'string' ? audio.audioUrl : '',
        audioFileName:
          typeof audio.audioFileName === 'string' && audio.audioFileName.trim().length > 0
            ? audio.audioFileName
            : null,
        contentType:
          typeof audio.contentType === 'string' && audio.contentType.trim().length > 0
            ? audio.contentType
            : null,
        size: typeof audio.size === 'number' ? audio.size : null,
        updatedAt:
          typeof audio.updatedAt === 'string' && audio.updatedAt.trim().length > 0
            ? audio.updatedAt
            : new Date().toISOString(),
      }))
      .filter((audio) => audio.audioUrl.length > 0);
  }

  if (typeof candidate.audioUrl === 'string' && candidate.audioUrl.trim().length > 0) {
    return [
      {
        id: 'audio-legacy',
        label:
          typeof candidate.audioFileName === 'string' && candidate.audioFileName.trim().length > 0
            ? candidate.audioFileName
            : 'Audio',
        kind: 'karaoke',
        guideRoles: [],
        audioUrl: candidate.audioUrl,
        audioFileName:
          typeof candidate.audioFileName === 'string' && candidate.audioFileName.trim().length > 0
            ? candidate.audioFileName
            : null,
        contentType: null,
        size: null,
        updatedAt: new Date().toISOString(),
      },
    ];
  }

  return [];
};

export const buildSharedSongPlaceholders = (guion: Dialogue[]): SharedSongAsset[] => {
  const occurrences = new Map<string, number>();
  const placeholders: SharedSongAsset[] = [];
  let currentScene: string | null = null;

  guion.forEach((line, lineIndex) => {
    if (isSceneMarker(line)) {
      currentScene = line.t;
      return;
    }

    if (!isSongCue(line)) {
      return;
    }

    const title = line.songTitle || DEFAULT_SONG_TITLE;
    const currentCount = occurrences.get(title) ?? 0;
    const nextCount = currentCount + 1;
    occurrences.set(title, nextCount);

    const baseSlug = sanitizeSlug(title) || 'cue';

    placeholders.push({
      id: `song-${baseSlug}-${nextCount}`,
      title,
      lineIndex,
      sceneTitle: currentScene,
      lyrics: line.t,
      audios: [],
      updatedAt: new Date().toISOString(),
    });
  });

  return placeholders;
};

export const syncSharedSongsWithScript = (
  guion: Dialogue[],
  existingSongs: unknown
): SharedSongAsset[] => {
  const placeholders = buildSharedSongPlaceholders(guion);
  const existingList = Array.isArray(existingSongs) ? existingSongs : [];
  const usedExistingIndexes = new Set<number>();

  return placeholders.map((placeholder) => {
    const matchingIndex = existingList.findIndex((song, index) => {
      if (usedExistingIndexes.has(index) || !song || typeof song !== 'object') {
        return false;
      }

      const candidate = song as Partial<SharedSongAsset> & {
        audioUrl?: unknown;
        audioFileName?: unknown;
      };

      if (candidate.id === placeholder.id) {
        return true;
      }

      if (typeof candidate.lineIndex === 'number' && candidate.lineIndex === placeholder.lineIndex) {
        return true;
      }

      return candidate.title === placeholder.title;
    });

    if (matchingIndex === -1) {
      return placeholder;
    }

    usedExistingIndexes.add(matchingIndex);
    const existingSong = existingList[matchingIndex] as Partial<SharedSongAsset>;

    return {
      ...placeholder,
      updatedAt:
        typeof existingSong.updatedAt === 'string' && existingSong.updatedAt.trim().length > 0
          ? existingSong.updatedAt
          : placeholder.updatedAt,
      audios: normalizeSongAudios(existingSong),
    };
  });
};

export const syncSharedMusicalNumbersWithScript = (
  songs: SharedSongAsset[],
  existingMusicalNumbers: unknown
): SharedMusicalNumberAsset[] => {
  if (!Array.isArray(existingMusicalNumbers)) {
    return [];
  }

  return existingMusicalNumbers
    .filter(
      (musicalNumber): musicalNumber is Partial<SharedMusicalNumberAsset> =>
        Boolean(musicalNumber) && typeof musicalNumber === 'object'
    )
    .map((musicalNumber, index) => {
      const songIds = Array.isArray(musicalNumber.songIds)
        ? Array.from(
            new Set(
              musicalNumber.songIds.filter(
                (songId): songId is string =>
                  typeof songId === 'string' && songs.some((song) => song.id === songId)
              )
            )
          )
        : [];

      const linkedSongs = songIds
        .map((songId) => songs.find((song) => song.id === songId) ?? null)
        .filter((song): song is SharedSongAsset => Boolean(song))
        .sort((leftSong, rightSong) => leftSong.lineIndex - rightSong.lineIndex);

      if (linkedSongs.length === 0) {
        return null;
      }

      return {
        id:
          typeof musicalNumber.id === 'string' && musicalNumber.id.trim().length > 0
            ? musicalNumber.id.trim()
            : `musical-number-${index + 1}`,
        title:
          typeof musicalNumber.title === 'string' && musicalNumber.title.trim().length > 0
            ? musicalNumber.title.trim()
            : linkedSongs[0].title,
        sceneTitle: linkedSongs[0].sceneTitle ?? null,
        startLineIndex: linkedSongs[0].lineIndex,
        endLineIndex: linkedSongs[linkedSongs.length - 1].lineIndex,
        songIds,
        audios: normalizeSongAudios(musicalNumber),
        updatedAt:
          typeof musicalNumber.updatedAt === 'string' && musicalNumber.updatedAt.trim().length > 0
            ? musicalNumber.updatedAt
            : new Date().toISOString(),
      };
    })
    .filter((musicalNumber): musicalNumber is SharedMusicalNumberAsset => Boolean(musicalNumber));
};

export const findSharedSongForLine = (
  songs: SharedSongAsset[] | null | undefined,
  guion: Dialogue[],
  line: Dialogue | null | undefined
) => {
  if (!line || !isSongCue(line) || !songs?.length) {
    return null;
  }

  const lineIndex = guion.indexOf(line);
  if (lineIndex >= 0) {
    const exactMatch = songs.find((song) => song.lineIndex === lineIndex);
    if (exactMatch) {
      return exactMatch;
    }
  }

  const title = line.songTitle || DEFAULT_SONG_TITLE;
  const titleMatches = songs.filter((song) => song.title === title).sort((leftSong, rightSong) => leftSong.lineIndex - rightSong.lineIndex);
  if (titleMatches.length === 0) {
    return null;
  }

  if (lineIndex < 0) {
    return titleMatches[0];
  }

  let occurrence = 0;
  for (let index = 0; index <= lineIndex; index += 1) {
    const candidateLine = guion[index];
    if (isSongCue(candidateLine) && (candidateLine.songTitle || DEFAULT_SONG_TITLE) === title) {
      occurrence += 1;
    }
  }

  return titleMatches[Math.max(0, occurrence - 1)] ?? titleMatches[0];
};

export const formatSongAudioKind = (kind: SharedSongAudioKind) =>
  kind === 'vocal_guide' ? 'Vocal guide' : 'Karaoke';
