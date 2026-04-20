const {
  hasSongAdminPasswordConfigured,
  isValidSongAdminPassword,
  parseJsonBody,
  readManifest,
  writeManifest,
} = require('./_shared');

const ensureConfigured = (response) => {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
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

    if (!isValidSongAdminPassword(password)) {
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
      const sceneTitle =
        typeof payload.sceneTitle === 'string' && payload.sceneTitle.trim()
          ? payload.sceneTitle.trim()
          : '';
      const startLineIndex =
        typeof payload.startLineIndex === 'number' ? payload.startLineIndex : -1;
      const endLineIndex = typeof payload.endLineIndex === 'number' ? payload.endLineIndex : -1;

      if (!title) {
        response.status(400).json({ error: 'Pon un nombre al numero musical antes de guardarlo.' });
        return;
      }

      if (!sceneTitle || startLineIndex < 0 || endLineIndex < 0) {
        response.status(400).json({ error: 'Selecciona la escena y el tramo del numero musical.' });
        return;
      }

      const selection = buildRangeSelection(sceneTitle, startLineIndex, endLineIndex, manifest.songs);

      if (selection.songIds.length === 0) {
        response.status(400).json({ error: 'El tramo seleccionado no incluye ninguna cancion.' });
        return;
      }

      const nextMusicalNumber = {
        id: `musical-number-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        title,
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
    const sceneTitle =
      typeof payload.sceneTitle === 'string' && payload.sceneTitle.trim()
        ? payload.sceneTitle.trim()
        : existingMusicalNumber.sceneTitle || '';
    const startLineIndex =
      typeof payload.startLineIndex === 'number'
        ? payload.startLineIndex
        : existingMusicalNumber.startLineIndex;
    const endLineIndex =
      typeof payload.endLineIndex === 'number'
        ? payload.endLineIndex
        : existingMusicalNumber.endLineIndex;

    if (!title) {
      response.status(400).json({ error: 'Pon un nombre al numero musical antes de guardarlo.' });
      return;
    }

    if (!sceneTitle || startLineIndex < 0 || endLineIndex < 0) {
      response.status(400).json({ error: 'Selecciona la escena y el tramo del numero musical.' });
      return;
    }

    const selection = buildRangeSelection(sceneTitle, startLineIndex, endLineIndex, manifest.songs);

    if (selection.songIds.length === 0) {
      response.status(400).json({ error: 'El tramo seleccionado no incluye ninguna cancion.' });
      return;
    }

    const updatedManifest = await writeManifest({
      ...manifest,
      musicalNumbers: (manifest.musicalNumbers || []).map((musicalNumber) =>
        musicalNumber.id === musicalNumberId
          ? {
              ...musicalNumber,
              title,
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
