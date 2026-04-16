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

const normalizeSongIds = (value, songs) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value.filter(
        (songId) =>
          typeof songId === 'string' && songId.trim() && songs.some((song) => song.id === songId)
      )
    )
  );
};

const buildSpan = (songIds, songs) => {
  const referencedSongs = songs
    .filter((song) => songIds.includes(song.id))
    .sort((leftSong, rightSong) => leftSong.lineIndex - rightSong.lineIndex);

  return {
    sceneTitle: referencedSongs[0]?.sceneTitle ?? null,
    startLineIndex: referencedSongs[0]?.lineIndex ?? -1,
    endLineIndex: referencedSongs[referencedSongs.length - 1]?.lineIndex ?? -1,
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
          : 'Numero musical';
      const songIds = normalizeSongIds(payload.songIds, manifest.songs);

      if (songIds.length < 2) {
        response.status(400).json({ error: 'Selecciona al menos dos bloques de cancion.' });
        return;
      }

      const span = buildSpan(songIds, manifest.songs);
      const nextMusicalNumber = {
        id: `musical-number-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        title,
        sceneTitle: span.sceneTitle,
        startLineIndex: span.startLineIndex,
        endLineIndex: span.endLineIndex,
        songIds,
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
        : existingMusicalNumber.title;
    const songIds = normalizeSongIds(payload.songIds, manifest.songs);

    if (songIds.length < 2) {
      response.status(400).json({ error: 'Selecciona al menos dos bloques de cancion.' });
      return;
    }

    const span = buildSpan(songIds, manifest.songs);
    const updatedManifest = await writeManifest({
      ...manifest,
      musicalNumbers: (manifest.musicalNumbers || []).map((musicalNumber) =>
        musicalNumber.id === musicalNumberId
          ? {
              ...musicalNumber,
              title,
              songIds,
              sceneTitle: span.sceneTitle,
              startLineIndex: span.startLineIndex,
              endLineIndex: span.endLineIndex,
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
