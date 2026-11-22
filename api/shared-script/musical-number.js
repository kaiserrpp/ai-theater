const { hasSharedStorage } = require('../../server/shared-storage');
const { isRangeInScene, markTimelinesForReview, normalizeNumberDetails } = require('../../shared/musicalNumbers');
const {
  hasSongAdminPasswordConfigured,
  isAuthorizedSongAdminRequest,
  parseJsonBody,
  readManifest,
  writeManifest,
} = require('./_shared');

const ensureConfigured = (response) => {
  if (!hasSharedStorage()) {
    response.status(500).json({ error: 'Falta configurar BLOB_READ_WRITE_TOKEN en Vercel.' });
    return false;
  }

  if (!hasSongAdminPasswordConfigured()) {
    response.status(500).json({ error: 'Falta configurar SONG_ADMIN_PASSWORD en Vercel.' });
    return false;
  }

  return true;
};

const normalizeRangeBoundaries = (startLineIndex, endLineIndex) =>
  startLineIndex <= endLineIndex
    ? { startLineIndex, endLineIndex }
    : { startLineIndex: endLineIndex, endLineIndex: startLineIndex };

const buildRangeSelection = (sceneTitle, startLineIndex, endLineIndex, songs) => {
  const normalizedRange = normalizeRangeBoundaries(startLineIndex, endLineIndex);
  const songIds = songs
    .filter((song) => {
      if (sceneTitle && song.sceneTitle !== sceneTitle) {
        return false;
      }

      return (
        song.lineIndex >= normalizedRange.startLineIndex &&
        song.lineIndex <= normalizedRange.endLineIndex
      );
    })
    .sort((leftSong, rightSong) => leftSong.lineIndex - rightSong.lineIndex)
    .map((song) => song.id);

  return {
    sceneTitle,
    startLineIndex: normalizedRange.startLineIndex,
    endLineIndex: normalizedRange.endLineIndex,
    songIds,
  };
};

const buildUnlinkedSelection = () => ({
  sceneTitle: null,
  startLineIndex: -1,
  endLineIndex: -1,
  songIds: [],
});

const resolveSelection = (manifest, payload, existing) => {
  const sceneTitle = typeof payload.sceneTitle === 'string' ? payload.sceneTitle.trim() : existing?.sceneTitle;
  const start = payload.startLineIndex ?? existing?.startLineIndex ?? -1;
  const end = payload.endLineIndex ?? existing?.endLineIndex ?? -1;
  if (start === -1 && end === -1) return buildUnlinkedSelection();
  const range = normalizeRangeBoundaries(start, end);
  if (!isRangeInScene(manifest.scriptData.guion, sceneTitle, range.startLineIndex, range.endLineIndex)) return null;
  return buildRangeSelection(sceneTitle, start, end, manifest.songs);
};

module.exports = async (request, response) => {
  if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'POST, PATCH, DELETE');
    response.status(405).json({ error: 'Metodo no permitido.' });
    return;
  }

  if (!ensureConfigured(response)) {
    return;
  }

  try {
    const payload = parseJsonBody(request);
    const password = typeof payload.password === 'string' ? payload.password : '';

    if (!isAuthorizedSongAdminRequest(request, password)) {
      response.status(401).json({ error: 'Password incorrecta.' });
      return;
    }

    const shareId = typeof payload.shareId === 'string' ? payload.shareId.trim() : '';
    if (!shareId) {
      response.status(400).json({ error: 'Falta identificar la obra compartida.' });
      return;
    }

    const manifest = await readManifest(shareId);
    const now = new Date().toISOString();

    if (request.method === 'POST') {
      const title =
        typeof payload.title === 'string' && payload.title.trim()
          ? payload.title.trim()
          : '';
      if (!title) {
        response.status(400).json({ error: 'Pon un nombre al numero musical antes de guardarlo.' });
        return;
      }

      const selection = resolveSelection(manifest, payload);
      if (!selection) {
        response.status(400).json({ error: 'Selecciona un tramo dentro de la misma escena.' });
        return;
      }

      const nextMusicalNumber = {
        id: `musical-number-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        title,
        ...normalizeNumberDetails({ roles: payload.roles, lyrics: payload.lyrics }),
        sceneTitle: selection.sceneTitle,
        startLineIndex: selection.startLineIndex,
        endLineIndex: selection.endLineIndex,
        songIds: selection.songIds,
        audios: [],
        updatedAt: now,
      };

      const updatedManifest = await writeManifest({
        ...manifest,
        musicalNumbers: [nextMusicalNumber, ...(manifest.musicalNumbers || [])],
        updatedAt: now,
      });

      response.status(200).json(updatedManifest);
      return;
    }

    const musicalNumberId =
      typeof payload.musicalNumberId === 'string' ? payload.musicalNumberId.trim() : '';
    if (!musicalNumberId) {
      response.status(400).json({ error: 'Falta identificar el numero musical.' });
      return;
    }

    const existingMusicalNumber = (manifest.musicalNumbers || []).find(
      (musicalNumber) => musicalNumber.id === musicalNumberId
    );

    if (!existingMusicalNumber) {
      response.status(404).json({ error: 'No existe ese numero musical.' });
      return;
    }

    if (request.method === 'DELETE') {
      if ((manifest.musicalAuditions || []).some((cut) => cut.musicalNumberId === musicalNumberId)) {
        return response.status(409).json({ error: 'Este número tiene fragmentos de audición. Elimina o mueve esos fragmentos antes de borrar el número.' });
      }
      const updatedManifest = await writeManifest({
        ...manifest,
        musicalNumbers: (manifest.musicalNumbers || []).filter(
          (musicalNumber) => musicalNumber.id !== musicalNumberId
        ),
        updatedAt: now,
      });

      response.status(200).json(updatedManifest);
      return;
    }

    const title =
      typeof payload.title === 'string' && payload.title.trim()
        ? payload.title.trim()
        : '';
    if (!title) {
      response.status(400).json({ error: 'Pon un nombre al numero musical antes de guardarlo.' });
      return;
    }

    const selection = resolveSelection(manifest, payload, existingMusicalNumber);
    if (!selection) {
      response.status(400).json({ error: 'Selecciona un tramo dentro de la misma escena.' });
      return;
    }

    const details = normalizeNumberDetails({ ...existingMusicalNumber, ...payload });
    const availableAudios = [
      ...existingMusicalNumber.audios,
      ...manifest.songs.filter((song) => selection.songIds.includes(song.id)).flatMap((song) => song.audios),
    ];
    const referenceAudioId = availableAudios.some((audio) => audio.id === details.referenceAudioId)
      ? details.referenceAudioId
      : undefined;
    if (typeof payload.referenceAudioId === 'string' && !referenceAudioId) {
      return response.status(400).json({ error: 'Elige una pista de este número como referencia.' });
    }
    const rangeChanged = selection.sceneTitle !== existingMusicalNumber.sceneTitle ||
      selection.startLineIndex !== existingMusicalNumber.startLineIndex ||
      selection.endLineIndex !== existingMusicalNumber.endLineIndex;

    const updatedManifest = await writeManifest({
      ...manifest,
      musicalNumbers: (manifest.musicalNumbers || []).map((musicalNumber) =>
        musicalNumber.id === musicalNumberId
          ? {
              ...musicalNumber,
              title,
              ...details,
              referenceAudioId,
              audios: rangeChanged ? markTimelinesForReview(musicalNumber.audios) : musicalNumber.audios,
              songIds: selection.songIds,
              sceneTitle: selection.sceneTitle,
              startLineIndex: selection.startLineIndex,
              endLineIndex: selection.endLineIndex,
              updatedAt: now,
            }
          : musicalNumber
      ),
      updatedAt: now,
    });

    response.status(200).json(updatedManifest);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'No se pudo actualizar el numero musical.';
    response.status(500).json({ error: message });
  }
};
