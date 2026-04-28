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

const normalizeRangeBoundaries = (startLineIndex: number, endLineIndex: number) =>
  startLineIndex <= endLineIndex
    ? { startLineIndex, endLineIndex }
    : { startLineIndex: endLineIndex, endLineIndex: startLineIndex };

export const getSongsForLineRange = (
  songs: SharedSongAsset[] | null | undefined,
  sceneTitle: string | null,
  startLineIndex: number,
  endLineIndex: number
) => {
  if (!songs?.length || startLineIndex < 0 || endLineIndex < 0) {
    return [];
  }

  const normalizedRange = normalizeRangeBoundaries(startLineIndex, endLineIndex);

  return songs
    .filter((song) => {
      if (sceneTitle && song.sceneTitle !== sceneTitle) {
        return false;
      }

      return (
        song.lineIndex >= normalizedRange.startLineIndex &&
        song.lineIndex <= normalizedRange.endLineIndex
      );
    })
    .sort((leftSong, rightSong) => leftSong.lineIndex - rightSong.lineIndex);
};

export const getSongIdsForLineRange = (
  songs: SharedSongAsset[] | null | undefined,
  sceneTitle: string | null,
  startLineIndex: number,
  endLineIndex: number
) =>
  Array.from(
    new Set(getSongsForLineRange(songs, sceneTitle, startLineIndex, endLineIndex).map((song) => song.id))
  );

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
      const startLineIndex =
        typeof musicalNumber.startLineIndex === 'number' && musicalNumber.startLineIndex >= 0
          ? musicalNumber.startLineIndex
          : -1;
      const endLineIndex =
        typeof musicalNumber.endLineIndex === 'number' && musicalNumber.endLineIndex >= 0
          ? musicalNumber.endLineIndex
          : -1;
      const sceneTitle =
        typeof musicalNumber.sceneTitle === 'string' && musicalNumber.sceneTitle.trim().length > 0
          ? musicalNumber.sceneTitle.trim()
          : null;
      const songIdsFromRange =
        startLineIndex >= 0 && endLineIndex >= 0
          ? getSongIdsForLineRange(songs, sceneTitle, startLineIndex, endLineIndex)
          : [];
      const legacySongIds = Array.isArray(musicalNumber.songIds)
        ? Array.from(
            new Set(
              musicalNumber.songIds.filter(
                (songId): songId is string =>
                  typeof songId === 'string' && songs.some((song) => song.id === songId)
              )
            )
          )
        : [];
      const songIds = Array.from(new Set(songIdsFromRange.length > 0 ? songIdsFromRange : legacySongIds));
      const linkedSongs = getSongsForLineRange(
        songs,
        sceneTitle ?? null,
        startLineIndex >= 0 ? startLineIndex : songs.find((song) => song.id === songIds[0])?.lineIndex ?? -1,
        endLineIndex >= 0
          ? endLineIndex
          : songs.find((song) => song.id === songIds[songIds.length - 1])?.lineIndex ?? -1
      );

      const normalizedRange =
        startLineIndex >= 0 && endLineIndex >= 0
          ? normalizeRangeBoundaries(startLineIndex, endLineIndex)
          : linkedSongs.length > 0
            ? normalizeRangeBoundaries(linkedSongs[0].lineIndex, linkedSongs[linkedSongs.length - 1].lineIndex)
            : normalizeRangeBoundaries(startLineIndex, endLineIndex);

      return {
        id:
          typeof musicalNumber.id === 'string' && musicalNumber.id.trim().length > 0
            ? musicalNumber.id.trim()
            : `musical-number-${index + 1}`,
        title:
          typeof musicalNumber.title === 'string' && musicalNumber.title.trim().length > 0
            ? musicalNumber.title.trim()
            : 'Numero musical',
        sceneTitle: sceneTitle ?? linkedSongs[0]?.sceneTitle ?? null,
        startLineIndex: normalizedRange.startLineIndex,
        endLineIndex: normalizedRange.endLineIndex,
        songIds,
        audios: normalizeSongAudios(musicalNumber),
        updatedAt:
          typeof musicalNumber.updatedAt === 'string' && musicalNumber.updatedAt.trim().length > 0
            ? musicalNumber.updatedAt
            : new Date().toISOString(),
      };
    })
    .filter(
      (musicalNumber): musicalNumber is SharedMusicalNumberAsset =>
        Boolean(musicalNumber) &&
        musicalNumber.startLineIndex >= 0 &&
        musicalNumber.endLineIndex >= 0
    );
};

const buildProjectedMusicalNumberAudioLabel = (
  musicalNumber: SharedMusicalNumberAsset,
  audio: SharedSongAudioAsset
) => {
  const trimmedNumberTitle = musicalNumber.title.trim();
  const trimmedAudioLabel = audio.label.trim();

  if (!trimmedNumberTitle || !trimmedAudioLabel) {
    return trimmedAudioLabel || trimmedNumberTitle || 'Audio';
  }

  const normalizedNumberTitle = trimmedNumberTitle.toLowerCase();
  const normalizedAudioLabel = trimmedAudioLabel.toLowerCase();

  if (normalizedAudioLabel.startsWith(normalizedNumberTitle)) {
    return trimmedAudioLabel;
  }

  return `${trimmedNumberTitle} · ${trimmedAudioLabel}`;
};

export const projectSharedSongsForPractice = (
  songs: SharedSongAsset[] | null | undefined,
  musicalNumbers: SharedMusicalNumberAsset[] | null | undefined
): SharedSongAsset[] => {
  if (!songs?.length) {
    return [];
  }

  const availableMusicalNumbers = (musicalNumbers ?? [])
    .filter((musicalNumber) => musicalNumber.songIds.length > 0 && musicalNumber.audios.length > 0)
    .sort((leftNumber, rightNumber) => leftNumber.startLineIndex - rightNumber.startLineIndex);

  return songs.map((song) => {
    const inheritedAudios = availableMusicalNumbers
      .filter((musicalNumber) => musicalNumber.songIds.includes(song.id))
      .flatMap((musicalNumber) =>
        musicalNumber.audios.map((audio) => ({
          ...audio,
          id: `musical-number:${musicalNumber.id}:${audio.id}`,
          label: buildProjectedMusicalNumberAudioLabel(musicalNumber, audio),
        }))
      );

    if (inheritedAudios.length === 0) {
      return song;
    }

    return {
      ...song,
      audios: [...song.audios, ...inheritedAudios],
    };
  });
};

export const countSharedLibraryAudios = (
  songs: SharedSongAsset[] | null | undefined,
  musicalNumbers: SharedMusicalNumberAsset[] | null | undefined
) =>
  (songs?.reduce((count, song) => count + song.audios.length, 0) ?? 0) +
  (musicalNumbers?.reduce((count, musicalNumber) => count + musicalNumber.audios.length, 0) ?? 0);

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
