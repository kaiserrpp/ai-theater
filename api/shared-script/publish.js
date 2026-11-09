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

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
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
      createdAt = typeof previousManifest.createdAt === 'string' ? previousManifest.createdAt : now;
    }

    const normalizedSongs = normalizeSongs(payload.songs);
    const normalizedNumbers = normalizeMusicalNumbers(payload.musicalNumbers, normalizedSongs, { allowUnlinked: true });
    const auditionNumberIds = new Set((previousManifest?.musicalAuditions || []).map((cut) => cut.musicalNumberId));
    const missingAuditionNumbers = (previousManifest?.musicalNumbers || []).filter((number) =>
      auditionNumberIds.has(number.id) && !normalizedNumbers.some((candidate) => candidate.id === number.id));

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
      musicalNumbers: [...normalizedNumbers, ...missingAuditionNumbers],
      // Only the dedicated scene endpoint edits this collection. In particular,
      // publishing from an older client must not erase existing audition scenes.
      auditionScenes: previousManifest?.auditionScenes || [],
      musicalAuditions: previousManifest?.musicalAuditions || [],
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
