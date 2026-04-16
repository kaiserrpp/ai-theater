const { head, list, put } = require('@vercel/blob');

const MANIFEST_VERSION = 3;
const EMPTY_SONGS = [];
const EMPTY_MUSICAL_NUMBERS = [];
const SONG_AUDIO_KINDS = new Set(['karaoke', 'vocal_guide']);

const buildManifestPath = (shareId) => `shared-scripts/${shareId}/manifest.json`;

const createShareId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isValidScriptData = (value) =>
  isObject(value) &&
  typeof value.obra === 'string' &&
  Array.isArray(value.personajes) &&
  Array.isArray(value.guion);

const normalizeMergeMap = (value) => {
  if (!isObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      ([sourceCharacter, targetCharacter]) =>
        typeof sourceCharacter === 'string' && typeof targetCharacter === 'string'
    )
  );
};

const normalizeGuideRoles = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.filter((role) => typeof role === 'string' && role.trim()))
  );
};

const normalizeSongAudioKind = (value) =>
  SONG_AUDIO_KINDS.has(value) ? value : 'karaoke';

const normalizeSongAudio = (value, fallbackIndex = 0) => {
  if (!isObject(value) || typeof value.audioUrl !== 'string' || !value.audioUrl.trim()) {
    return null;
  }

  const kind = normalizeSongAudioKind(value.kind);

  return {
    id:
      typeof value.id === 'string' && value.id.trim()
        ? value.id.trim()
        : `audio-${fallbackIndex + 1}`,
    label:
      typeof value.label === 'string' && value.label.trim()
        ? value.label.trim()
        : kind === 'vocal_guide'
          ? 'Vocal guide'
          : 'Karaoke',
    kind,
    guideRoles: normalizeGuideRoles(value.guideRoles),
    audioUrl: value.audioUrl.trim(),
    audioFileName:
      typeof value.audioFileName === 'string' && value.audioFileName.trim()
        ? value.audioFileName.trim()
        : null,
    contentType:
      typeof value.contentType === 'string' && value.contentType.trim()
        ? value.contentType.trim()
        : null,
    size: typeof value.size === 'number' ? value.size : null,
    updatedAt:
      typeof value.updatedAt === 'string' && value.updatedAt.trim()
        ? value.updatedAt.trim()
        : new Date().toISOString(),
  };
};

const normalizeSongs = (value) => {
  if (!Array.isArray(value)) {
    return EMPTY_SONGS;
  }

  return value
    .filter((song) => isObject(song) && typeof song.id === 'string' && typeof song.title === 'string')
    .map((song) => ({
      id: song.id,
      title: song.title,
      lineIndex: typeof song.lineIndex === 'number' ? song.lineIndex : -1,
      sceneTitle: typeof song.sceneTitle === 'string' ? song.sceneTitle : null,
      lyrics: typeof song.lyrics === 'string' ? song.lyrics : '',
      audios: Array.isArray(song.audios)
        ? song.audios
            .map((audio, index) => normalizeSongAudio(audio, index))
            .filter(Boolean)
        : (() => {
            const legacyAudio = normalizeSongAudio(
              {
                id: 'audio-legacy',
                label: typeof song.audioFileName === 'string' ? song.audioFileName : 'Audio',
                kind: 'karaoke',
                guideRoles: [],
                audioUrl: song.audioUrl,
                audioFileName: song.audioFileName,
                updatedAt: song.updatedAt,
              },
              0
            );

            return legacyAudio ? [legacyAudio] : [];
          })(),
      updatedAt: typeof song.updatedAt === 'string' ? song.updatedAt : new Date().toISOString(),
    }));
};

const resolveMusicalNumberIndexes = (songIds, songs) => {
  const referencedSongs = songs.filter((song) => songIds.includes(song.id));
  const sortedIndexes = referencedSongs
    .map((song) => song.lineIndex)
    .filter((lineIndex) => typeof lineIndex === 'number' && lineIndex >= 0)
    .sort((leftIndex, rightIndex) => leftIndex - rightIndex);

  return {
    startLineIndex: sortedIndexes[0] ?? -1,
    endLineIndex: sortedIndexes[sortedIndexes.length - 1] ?? -1,
    sceneTitle: referencedSongs[0]?.sceneTitle ?? null,
  };
};

const normalizeMusicalNumbers = (value, songs = EMPTY_SONGS) => {
  if (!Array.isArray(value)) {
    return EMPTY_MUSICAL_NUMBERS;
  }

  return value
    .filter(
      (musicalNumber) =>
        isObject(musicalNumber) &&
        typeof musicalNumber.id === 'string' &&
        typeof musicalNumber.title === 'string'
    )
    .map((musicalNumber) => {
      const songIds = Array.isArray(musicalNumber.songIds)
        ? Array.from(
            new Set(
              musicalNumber.songIds.filter(
                (songId) =>
                  typeof songId === 'string' &&
                  songId.trim() &&
                  songs.some((song) => song.id === songId)
              )
            )
          )
        : [];
      const resolvedIndexes = resolveMusicalNumberIndexes(songIds, songs);

      return {
        id: musicalNumber.id.trim(),
        title: musicalNumber.title.trim() || 'Numero musical',
        sceneTitle:
          typeof musicalNumber.sceneTitle === 'string' && musicalNumber.sceneTitle.trim()
            ? musicalNumber.sceneTitle.trim()
            : resolvedIndexes.sceneTitle,
        startLineIndex:
          typeof musicalNumber.startLineIndex === 'number' && musicalNumber.startLineIndex >= 0
            ? musicalNumber.startLineIndex
            : resolvedIndexes.startLineIndex,
        endLineIndex:
          typeof musicalNumber.endLineIndex === 'number' && musicalNumber.endLineIndex >= 0
            ? musicalNumber.endLineIndex
            : resolvedIndexes.endLineIndex,
        songIds,
        audios: Array.isArray(musicalNumber.audios)
          ? musicalNumber.audios
              .map((audio, index) => normalizeSongAudio(audio, index))
              .filter(Boolean)
          : [],
        updatedAt:
          typeof musicalNumber.updatedAt === 'string' && musicalNumber.updatedAt.trim()
            ? musicalNumber.updatedAt
            : new Date().toISOString(),
      };
    })
    .filter((musicalNumber) => musicalNumber.songIds.length > 0);
};

const normalizeManifest = (value) => {
  const songs = normalizeSongs(value?.songs);

  return {
    version: MANIFEST_VERSION,
    shareId: typeof value?.shareId === 'string' ? value.shareId : createShareId(),
    fileName:
      typeof value?.fileName === 'string' && value.fileName.trim()
        ? value.fileName.trim()
        : isValidScriptData(value?.scriptData)
          ? value.scriptData.obra
          : 'Obra compartida',
    scriptData: isValidScriptData(value?.scriptData)
      ? value.scriptData
      : { obra: 'Obra compartida', personajes: [], guion: [] },
    mergeMap: normalizeMergeMap(value?.mergeMap),
    songs,
    musicalNumbers: normalizeMusicalNumbers(value?.musicalNumbers, songs),
    createdAt:
      typeof value?.createdAt === 'string' && value.createdAt.trim()
        ? value.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof value?.updatedAt === 'string' && value.updatedAt.trim()
        ? value.updatedAt
        : new Date().toISOString(),
  };
};

const getSongAdminPasswordFromRequest = (request) => {
  const headerValue = request.headers['x-song-admin-password'];
  if (Array.isArray(headerValue)) {
    return headerValue[0] ?? '';
  }

  if (typeof headerValue === 'string') {
    return headerValue;
  }

  return '';
};

const hasSongAdminPasswordConfigured = () =>
  typeof process.env.SONG_ADMIN_PASSWORD === 'string' && process.env.SONG_ADMIN_PASSWORD.length > 0;

const isValidSongAdminPassword = (password) =>
  hasSongAdminPasswordConfigured() && password === process.env.SONG_ADMIN_PASSWORD;

const buildShareUrl = (request, shareId) => {
  const protocol = request.headers['x-forwarded-proto'] || 'https';
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  return `${protocol}://${host}/?share=${encodeURIComponent(shareId)}`;
};

const parseJsonBody = (request) => {
  if (typeof request.body === 'string') {
    return JSON.parse(request.body);
  }

  return request.body || {};
};

const readManifestFromUrl = async (url) => {
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error('No se pudo descargar la obra compartida.');
  }

  const manifest = await response.json();
  return normalizeManifest(manifest);
};

const readManifest = async (shareId) => {
  const blob = await head(buildManifestPath(shareId));
  return readManifestFromUrl(blob.url);
};

const writeManifest = async (manifest) => {
  const normalizedManifest = normalizeManifest(manifest);

  await put(buildManifestPath(normalizedManifest.shareId), JSON.stringify(normalizedManifest, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json; charset=utf-8',
  });

  return normalizedManifest;
};

const buildManifestSummary = (manifest) => ({
  shareId: manifest.shareId,
  obra:
    manifest?.scriptData && typeof manifest.scriptData.obra === 'string'
      ? manifest.scriptData.obra
      : manifest.fileName,
  fileName: manifest.fileName,
  mergeCount: Object.keys(normalizeMergeMap(manifest.mergeMap)).length,
  songCount: normalizeSongs(manifest.songs).length,
  musicalNumberCount: normalizeMusicalNumbers(manifest.musicalNumbers, normalizeSongs(manifest.songs)).length,
  createdAt: typeof manifest.createdAt === 'string' ? manifest.createdAt : new Date().toISOString(),
  updatedAt: typeof manifest.updatedAt === 'string' ? manifest.updatedAt : new Date().toISOString(),
});

const listSharedScriptSummaries = async () => {
  const result = await list({
    prefix: 'shared-scripts/',
    limit: 200,
  });

  const manifestBlobs = result.blobs.filter((blob) => blob.pathname.endsWith('/manifest.json'));

  const manifests = await Promise.all(
    manifestBlobs.map(async (blob) => {
      try {
        return await readManifestFromUrl(blob.url);
      } catch {
        return null;
      }
    })
  );

  return manifests
    .filter(Boolean)
    .map(buildManifestSummary)
    .sort((leftManifest, rightManifest) => rightManifest.updatedAt.localeCompare(leftManifest.updatedAt));
};

module.exports = {
  MANIFEST_VERSION,
  buildShareUrl,
  createShareId,
  getSongAdminPasswordFromRequest,
  hasSongAdminPasswordConfigured,
  isValidScriptData,
  isValidSongAdminPassword,
  listSharedScriptSummaries,
  normalizeManifest,
  normalizeMergeMap,
  normalizeMusicalNumbers,
  normalizeSongs,
  parseJsonBody,
  readManifest,
  writeManifest,
};
