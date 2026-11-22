const { hasSharedStorage } = require('../../server/shared-storage');
const { isRangeInScene, markTimelinesForReview } = require('../../shared/musicalNumbers');
const {
  MANIFEST_VERSION,
  buildShareUrl,
  createShareId,
  isValidScriptData,
  hasSongAdminPasswordConfigured,
  isAuthorizedSongAdminRequest,
  normalizeMergeMap,
  normalizeMusicalNumbers,
  normalizeSongs,
  parseJsonBody,
  readManifest,
  writeManifest,
} = require('./_shared');

module.exports = async (request, response) => {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Metodo no permitido.' });
    return;
  }

  if (!hasSharedStorage()) {
    response.status(500).json({ error: 'Falta configurar BLOB_READ_WRITE_TOKEN en Vercel.' });
    return;
  }

  try {
    const payload = parseJsonBody(request);

    if (!hasSongAdminPasswordConfigured()) {
      response.status(500).json({ error: 'Falta configurar la clave de gestión.' });
      return;
    }
    if (!isAuthorizedSongAdminRequest(request, payload.password)) {
      response.status(401).json({ error: 'Clave de gestión incorrecta.' });
      return;
    }

    if (!isValidScriptData(payload.scriptData)) {
      response.status(400).json({ error: 'El guion compartido no es valido.' });
      return;
    }

    const shareId =
      typeof payload.shareId === 'string' && payload.shareId.trim()
        ? payload.shareId.trim()
        : createShareId();

    const now = new Date().toISOString();
    let createdAt = now;
    let previousManifest = null;

    if (payload.shareId) {
      previousManifest = await readManifest(shareId);
      if (payload.attachInitialScript === true && previousManifest.scriptData.guion.length) {
        return response.status(409).json({ error: 'La obra ya tiene un guion. Vuelve a abrirla.' });
      }
      createdAt = typeof previousManifest.createdAt === 'string' ? previousManifest.createdAt : now;
    }

    const normalizedSongs = normalizeSongs(payload.songs);
    const normalizedNumbers = normalizeMusicalNumbers(payload.musicalNumbers, normalizedSongs, { allowUnlinked: true });
    const previousNumbers = previousManifest?.musicalNumbers || [];
    const previousIds = new Set(previousNumbers.map((number) => number.id));
    // Number details and tracks are edited by their own endpoints. A script
    // publish can carry data from an earlier client or an earlier read.
    const musicalNumbers = previousNumbers.map((number) => {
      if (number.startLineIndex < 0) return number;
      const { sceneTitle, startLineIndex, endLineIndex } = number;
      const oldLines = previousManifest.scriptData.guion.slice(startLineIndex, endLineIndex + 1);
      const newLines = payload.scriptData.guion.slice(startLineIndex, endLineIndex + 1);
      if (isRangeInScene(payload.scriptData.guion, sceneTitle, startLineIndex, endLineIndex) &&
          JSON.stringify(oldLines) === JSON.stringify(newLines)) return number;
      return {
        ...number,
        startLineIndex: -1,
        endLineIndex: -1,
        songIds: [],
        audios: markTimelinesForReview(number.audios),
        updatedAt: now,
      };
    });

    const manifest = {
      version: MANIFEST_VERSION,
      shareId,
      fileName:
        typeof payload.fileName === 'string' && payload.fileName.trim()
          ? payload.fileName.trim()
          : payload.scriptData.obra,
      scriptData: payload.scriptData,
      mergeMap: normalizeMergeMap(payload.mergeMap),
      songs: normalizedSongs,
      musicalNumbers: [...musicalNumbers, ...normalizedNumbers.filter((number) => !previousIds.has(number.id))],
      // Only the dedicated scene endpoint edits this collection. In particular,
      // publishing from an older client must not erase existing audition scenes.
      auditionScenes: previousManifest?.auditionScenes || [],
      musicalAuditions: previousManifest?.musicalAuditions || [],
      appearance: previousManifest?.appearance,
      createdAt,
      updatedAt: now,
    };

    const normalizedManifest = await writeManifest(manifest);

    response.status(200).json({
      manifest: normalizedManifest,
      shareUrl: buildShareUrl(request, shareId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo publicar la obra compartida.';
    response.status(500).json({ error: message });
  }
};
