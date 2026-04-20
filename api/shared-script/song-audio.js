const {
  hasSongAdminPasswordConfigured,
  isValidSongAdminPassword,
  parseJsonBody,
  readManifest,
  writeManifest,
} = require('./_shared');

const AUDIO_KINDS = new Set(['karaoke', 'vocal_guide']);

const normalizeGuideRoles = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.filter((role) => typeof role === 'string' && role.trim()))
  );
};

const resolveLabel = (label, kind, fallbackLabel) => {
  if (typeof label === 'string' && label.trim()) {
    return label.trim();
  }

  if (fallbackLabel) {
    return fallbackLabel;
  }

  return kind === 'vocal_guide' ? 'Vocal guide' : 'Karaoke';
};

const resolveKind = (value, fallbackKind = 'karaoke') =>
  AUDIO_KINDS.has(value) ? value : fallbackKind;

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

const findSong = (manifest, songId) => manifest.songs.find((song) => song.id === songId);

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
    const songId = typeof payload.songId === 'string' ? payload.songId.trim() : '';

    if (!shareId || !songId) {
      response.status(400).json({ error: 'Faltan datos de la cancion.' });
      return;
    }

    const manifest = await readManifest(shareId);
    const song = findSong(manifest, songId);

    if (!song) {
      response.status(404).json({ error: 'No existe esa cancion en la obra compartida.' });
      return;
    }

    const now = new Date().toISOString();

    if (request.method === 'POST') {
      const audioUrl = typeof payload.audioUrl === 'string' ? payload.audioUrl.trim() : '';

      if (!audioUrl) {
        response.status(400).json({ error: 'Faltan datos para registrar el audio.' });
        return;
      }

      const kind = resolveKind(payload.kind);
      const label =
        typeof payload.label === 'string' && payload.label.trim() ? payload.label.trim() : '';
      const guideRoles = normalizeGuideRoles(payload.guideRoles);

      if (!label) {
        response.status(400).json({ error: 'Pon un nombre al audio antes de guardarlo.' });
        return;
      }

      if (guideRoles.length === 0) {
        response.status(400).json({ error: 'Selecciona al menos un personaje para este audio.' });
        return;
      }

      const nextAudio = {
        id: `audio-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        label: resolveLabel(label, kind),
        kind,
        guideRoles,
        audioUrl,
        audioFileName:
          typeof payload.audioFileName === 'string' && payload.audioFileName.trim()
            ? payload.audioFileName.trim()
            : null,
        contentType:
          typeof payload.contentType === 'string' && payload.contentType.trim()
            ? payload.contentType.trim()
            : null,
        size: typeof payload.size === 'number' ? payload.size : null,
        updatedAt: now,
      };

      const songs = manifest.songs.map((candidateSong) =>
        candidateSong.id === songId
          ? {
              ...candidateSong,
              audios: [nextAudio, ...candidateSong.audios],
              updatedAt: now,
            }
          : candidateSong
      );

      const updatedManifest = await writeManifest({
        ...manifest,
        songs,
        updatedAt: now,
      });

      response.status(200).json(updatedManifest);
      return;
    }

    const audioId = typeof payload.audioId === 'string' ? payload.audioId.trim() : '';

    if (!audioId) {
      response.status(400).json({ error: 'Falta identificar el audio.' });
      return;
    }

    const existingAudio = song.audios.find((audio) => audio.id === audioId);

    if (!existingAudio) {
      response.status(404).json({ error: 'No existe ese audio en la cancion.' });
      return;
    }

    if (request.method === 'DELETE') {
      const songs = manifest.songs.map((candidateSong) =>
        candidateSong.id === songId
          ? {
              ...candidateSong,
              audios: candidateSong.audios.filter((audio) => audio.id !== audioId),
              updatedAt: now,
            }
          : candidateSong
      );

      const updatedManifest = await writeManifest({
        ...manifest,
        songs,
        updatedAt: now,
      });

      response.status(200).json(updatedManifest);
      return;
    }

    const kind = resolveKind(payload.kind, existingAudio.kind);
    const nextLabel =
      typeof payload.label === 'string' && payload.label.trim() ? payload.label.trim() : '';
    const nextGuideRoles = Array.isArray(payload.guideRoles)
      ? normalizeGuideRoles(payload.guideRoles)
      : existingAudio.guideRoles;

    if (!nextLabel) {
      response.status(400).json({ error: 'Pon un nombre al audio antes de guardarlo.' });
      return;
    }

    if (nextGuideRoles.length === 0) {
      response.status(400).json({ error: 'Selecciona al menos un personaje para este audio.' });
      return;
    }

    const songs = manifest.songs.map((candidateSong) =>
      candidateSong.id === songId
        ? {
            ...candidateSong,
            audios: candidateSong.audios.map((audio) =>
              audio.id === audioId
                ? {
                    ...audio,
                    label: resolveLabel(nextLabel, kind, existingAudio.label),
                    kind,
                    guideRoles: nextGuideRoles,
                    audioUrl:
                      typeof payload.audioUrl === 'string' && payload.audioUrl.trim()
                        ? payload.audioUrl.trim()
                        : existingAudio.audioUrl,
                    audioFileName:
                      typeof payload.audioFileName === 'string' && payload.audioFileName.trim()
                        ? payload.audioFileName.trim()
                        : existingAudio.audioFileName,
                    contentType:
                      typeof payload.contentType === 'string' && payload.contentType.trim()
                        ? payload.contentType.trim()
                        : existingAudio.contentType,
                    size: typeof payload.size === 'number' ? payload.size : existingAudio.size,
                    updatedAt: now,
                  }
                : audio
            ),
            updatedAt: now,
          }
        : candidateSong
    );

    const updatedManifest = await writeManifest({
      ...manifest,
      songs,
      updatedAt: now,
    });

    response.status(200).json(updatedManifest);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'No se pudo actualizar el audio de la cancion.';
    response.status(500).json({ error: message });
  }
};
