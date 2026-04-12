const { head, put } = require('@vercel/blob');

const MANIFEST_VERSION = 1;
const EMPTY_SONGS = [];

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

const normalizeSongs = (value) => {
  if (!Array.isArray(value)) {
    return EMPTY_SONGS;
  }

  return value
    .filter((song) => isObject(song) && typeof song.id === 'string' && typeof song.title === 'string')
    .map((song) => ({
      id: song.id,
      title: song.title,
      audioUrl: typeof song.audioUrl === 'string' ? song.audioUrl : null,
      audioFileName: typeof song.audioFileName === 'string' ? song.audioFileName : null,
      updatedAt: typeof song.updatedAt === 'string' ? song.updatedAt : new Date().toISOString(),
    }));
};

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

const readManifest = async (shareId) => {
  const blob = await head(buildManifestPath(shareId));
  const response = await fetch(blob.url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error('No se pudo descargar la obra compartida.');
  }

  return response.json();
};

const writeManifest = async (manifest) => {
  await put(buildManifestPath(manifest.shareId), JSON.stringify(manifest, null, 2), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json; charset=utf-8',
  });
};

module.exports = {
  MANIFEST_VERSION,
  buildShareUrl,
  createShareId,
  isValidScriptData,
  normalizeMergeMap,
  normalizeSongs,
  parseJsonBody,
  readManifest,
  writeManifest,
};
