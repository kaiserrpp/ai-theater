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

const normalizeSongIds = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(value.filter((songId) => typeof songId === 'string' && songId.trim()))
  );
};

const areSongIdsEqual = (leftSongIds, rightSongIds) => {
  if (leftSongIds.length !== rightSongIds.length) {
    return false;
  }

  const normalizedLeft = [...leftSongIds].sort();
  const normalizedRight = [...rightSongIds].sort();

  return normalizedLeft.every((songId, index) => songId === normalizedRight[index]);
};

const resolveMusicalNumber = (manifest, payload) => {
  const allMusicalNumbers = Array.isArray(manifest.musicalNumbers) ? manifest.musicalNumbers : [];
  const musicalNumberId =
    typeof payload.musicalNumberId === 'string' ? payload.musicalNumberId.trim() : '';

  if (musicalNumberId) {
    const exactMatch = allMusicalNumbers.find((candidate) => candidate.id === musicalNumberId);
    if (exactMatch) {
      return exactMatch;
    }
  }

  const title =
    typeof payload.musicalNumberTitle === 'string' && payload.musicalNumberTitle.trim()
      ? payload.musicalNumberTitle.trim()
      : '';
  const songIds = normalizeSongIds(payload.songIds);

  if (!title && songIds.length === 0) {
    return null;
  }

  const matchingCandidates = allMusicalNumbers.filter((candidate) => {
    if (title && candidate.title !== title) {
      return false;
    }

    if (songIds.length > 0 && !areSongIdsEqual(candidate.songIds || [], songIds)) {
      return false;
    }

    return true;
  });

  if (matchingCandidates.length === 1) {
    return matchingCandidates[0];
  }

  if (songIds.length > 0) {
    return allMusicalNumbers.find((candidate) => areSongIdsEqual(candidate.songIds || [], songIds)) ?? null;
  }

  return title ? allMusicalNumbers.find((candidate) => candidate.title === title) ?? null : null;
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
    const requestedMusicalNumberId =
      typeof payload.musicalNumberId === 'string' ? payload.musicalNumberId.trim() : '';

    if (!shareId || !requestedMusicalNumberId) {
      response.status(400).json({ error: 'Faltan datos del numero musical.' });
      return;
    }

    const manifest = await readManifest(shareId);
    const musicalNumber = resolveMusicalNumber(manifest, payload);

    if (!musicalNumber) {
      response.status(404).json({ error: 'No existe ese numero musical en la obra compartida.' });
      return;
    }

    const musicalNumberId = musicalNumber.id;

    const now = new Date().toISOString();

    if (request.method === 'POST') {
      const audioUrl = typeof payload.audioUrl === 'string' ? payload.audioUrl.trim() : '';
      if (!audioUrl) {
        response.status(400).json({ error: 'Faltan datos para registrar el audio.' });
        return;
      }

      const kind = resolveKind(payload.kind);
      const nextAudio = {
        id: `audio-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        label: resolveLabel(payload.label, kind),
        kind,
        guideRoles: normalizeGuideRoles(payload.guideRoles),
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

      const updatedManifest = await writeManifest({
        ...manifest,
        musicalNumbers: (manifest.musicalNumbers || []).map((candidate) =>
          candidate.id === musicalNumberId
            ? {
                ...candidate,
                audios: [nextAudio, ...candidate.audios],
                updatedAt: now,
              }
            : candidate
        ),
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

    const existingAudio = musicalNumber.audios.find((audio) => audio.id === audioId);
    if (!existingAudio) {
      response.status(404).json({ error: 'No existe ese audio en el numero musical.' });
      return;
    }

    if (request.method === 'DELETE') {
      const updatedManifest = await writeManifest({
        ...manifest,
        musicalNumbers: (manifest.musicalNumbers || []).map((candidate) =>
          candidate.id === musicalNumberId
            ? {
                ...candidate,
                audios: candidate.audios.filter((audio) => audio.id !== audioId),
                updatedAt: now,
              }
            : candidate
        ),
        updatedAt: now,
      });

      response.status(200).json(updatedManifest);
      return;
    }

    const kind = resolveKind(payload.kind, existingAudio.kind);
    const updatedManifest = await writeManifest({
      ...manifest,
      musicalNumbers: (manifest.musicalNumbers || []).map((candidate) =>
        candidate.id === musicalNumberId
          ? {
              ...candidate,
              audios: candidate.audios.map((audio) =>
                audio.id === audioId
                  ? {
                      ...audio,
                      label: resolveLabel(payload.label, kind, existingAudio.label),
                      kind,
                      guideRoles: Array.isArray(payload.guideRoles)
                        ? normalizeGuideRoles(payload.guideRoles)
                        : existingAudio.guideRoles,
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
          : candidate
      ),
      updatedAt: now,
    });

    response.status(200).json(updatedManifest);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No se pudo actualizar el audio del numero musical.';
    response.status(500).json({ error: message });
  }
};
