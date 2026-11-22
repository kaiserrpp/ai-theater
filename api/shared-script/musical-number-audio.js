const { hasSharedStorage } = require('../../server/shared-storage');
const { normalizeChoirPart } = require('../../shared/choirParts');
const { normalizeRoles } = require('../../shared/musicalAuditions');
const {
  hasSongAdminPasswordConfigured,
  isAuthorizedSongAdminRequest,
  parseJsonBody,
  readManifest,
  writeManifest,
} = require('./_shared');

const AUDIO_KINDS = new Set(['karaoke', 'vocal_guide']);

const normalizeTimelineCues = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((cue) => cue && typeof cue === 'object' && !Array.isArray(cue))
    .map((cue, index) => {
      const targetLineIndex =
        typeof cue.targetLineIndex === 'number' && Number.isFinite(cue.targetLineIndex)
          ? Math.max(0, Math.round(cue.targetLineIndex))
          : -1;
      const atMs =
        typeof cue.atMs === 'number' && Number.isFinite(cue.atMs)
          ? Math.max(0, Math.round(cue.atMs))
          : -1;

      return {
        id:
          typeof cue.id === 'string' && cue.id.trim()
            ? cue.id.trim()
            : `cue-${targetLineIndex}-${index + 1}`,
        atMs,
        targetLineIndex,
        targetKind: cue.targetKind === 'song' ? 'song' : 'dialogue',
      };
    })
    .filter((cue) => cue.atMs >= 0 && cue.targetLineIndex >= 0)
    .sort((leftCue, rightCue) => leftCue.atMs - rightCue.atMs);
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

const matchesRange = (candidate, payload) => {
  const sceneTitle =
    typeof payload.sceneTitle === 'string' && payload.sceneTitle.trim()
      ? payload.sceneTitle.trim()
      : '';
  const startLineIndex =
    typeof payload.startLineIndex === 'number' ? payload.startLineIndex : null;
  const endLineIndex = typeof payload.endLineIndex === 'number' ? payload.endLineIndex : null;

  if (!sceneTitle || startLineIndex === null || endLineIndex === null) {
    return false;
  }

  const normalizedStart = Math.min(startLineIndex, endLineIndex);
  const normalizedEnd = Math.max(startLineIndex, endLineIndex);

  return (
    candidate.sceneTitle === sceneTitle &&
    candidate.startLineIndex === normalizedStart &&
    candidate.endLineIndex === normalizedEnd
  );
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

    if (
      (typeof payload.sceneTitle === 'string' && payload.sceneTitle.trim()) ||
      typeof payload.startLineIndex === 'number' ||
      typeof payload.endLineIndex === 'number'
    ) {
      return matchesRange(candidate, payload);
    }

    if (songIds.length > 0 && !areSongIdsEqual(candidate.songIds || [], songIds)) {
      return false;
    }

    return true;
  });

  if (matchingCandidates.length === 1) {
    return matchingCandidates[0];
  }

  const rangeMatch = allMusicalNumbers.find((candidate) => matchesRange(candidate, payload));
  if (rangeMatch) {
    return rangeMatch;
  }

  if (songIds.length > 0) {
    return allMusicalNumbers.find((candidate) => areSongIdsEqual(candidate.songIds || [], songIds)) ?? null;
  }

  return title ? allMusicalNumbers.find((candidate) => candidate.title === title) ?? null : null;
};

const resolveKind = (value, fallbackKind = 'karaoke') =>
  AUDIO_KINDS.has(value) ? value : fallbackKind;

const readAudioAssignment = (payload, kind, allowEmptyGuideRoles, existingAudio) => {
  const requestedPart = payload.choirPart === undefined ? existingAudio?.choirPart : payload.choirPart;
  const choirPart = normalizeChoirPart(requestedPart);
  const guideRoles = Array.isArray(payload.guideRoles)
    ? normalizeRoles(payload.guideRoles)
    : existingAudio?.guideRoles ?? [];
  const audibleRoles = Array.isArray(payload.audibleRoles)
    ? normalizeRoles(payload.audibleRoles)
    : payload.audibleRoles === null ? null : existingAudio?.audibleRoles;

  if (requestedPart != null && !choirPart) return { error: 'Selecciona una cuerda vocal válida.' };
  if (choirPart && (kind !== 'vocal_guide' || guideRoles.length)) {
    return { error: 'Una pista de coro debe ser una guía con una cuerda vocal.' };
  }
  if (!choirPart && !allowEmptyGuideRoles && !guideRoles.length && payload.audibleRoles === undefined && !existingAudio) {
    return { error: 'Selecciona al menos un personaje para este audio.' };
  }
  return { guideRoles, choirPart, audibleRoles };
};

const areCuesInRange = (cues, number, guion) => cues.every((cue) => {
  const line = guion[cue.targetLineIndex];
  return number.startLineIndex >= 0 && cue.targetLineIndex >= number.startLineIndex &&
    cue.targetLineIndex <= number.endLineIndex && line && line.p !== 'ESCENA_SISTEMA' &&
    cue.targetKind === (line.p === 'CANCION_SISTEMA' || line.k === 'song' ? 'song' : 'dialogue');
});

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

const isScriptlessManifest = (manifest) =>
  Array.isArray(manifest?.scriptData?.guion) && manifest.scriptData.guion.length === 0;

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
    const allowEmptyGuideRoles = isScriptlessManifest(manifest);

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
      if (!label) {
        response.status(400).json({ error: 'Pon un nombre al audio antes de guardarlo.' });
        return;
      }

      const assignment = readAudioAssignment(payload, kind, allowEmptyGuideRoles);
      if (assignment.error) {
        response.status(400).json({ error: assignment.error });
        return;
      }

      const { guideRoles, choirPart, audibleRoles } = assignment;
      if (choirPart && musicalNumber.audios.some((audio) => audio.choirPart === choirPart && audio.audioUrl === audioUrl)) {
        response.status(200).json(manifest);
        return;
      }

      const nextAudio = {
        id: `audio-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
        label: resolveLabel(label, kind),
        kind,
        guideRoles,
        ...(choirPart ? { choirPart } : {}),
        audibleRoles,
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
        timelineCues: normalizeTimelineCues(payload.timelineCues),
        updatedAt: now,
      };
      if (!areCuesInRange(nextAudio.timelineCues, musicalNumber, manifest.scriptData.guion)) {
        return response.status(400).json({ error: 'Las marcas deben apuntar a bloques del tramo elegido.' });
      }

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
                referenceAudioId: candidate.referenceAudioId === audioId ? undefined : candidate.referenceAudioId,
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
    const nextLabel =
      typeof payload.label === 'string' && payload.label.trim() ? payload.label.trim() : '';
    if (!nextLabel) {
      response.status(400).json({ error: 'Pon un nombre al audio antes de guardarlo.' });
      return;
    }

    const assignment = readAudioAssignment(payload, kind, allowEmptyGuideRoles, existingAudio);
    if (assignment.error) {
      response.status(400).json({ error: assignment.error });
      return;
    }

    const nextAudioUrl = typeof payload.audioUrl === 'string' && payload.audioUrl.trim() ? payload.audioUrl.trim() : existingAudio.audioUrl;
    const savesTimeline = Array.isArray(payload.timelineCues);
    const timelineCues = savesTimeline ? normalizeTimelineCues(payload.timelineCues) : existingAudio.timelineCues || [];
    if (savesTimeline && !areCuesInRange(timelineCues, musicalNumber, manifest.scriptData.guion)) {
      return response.status(400).json({ error: 'Las marcas deben apuntar a bloques del tramo elegido.' });
    }
    const timelineNeedsReview = timelineCues.length > 0 &&
      (nextAudioUrl !== existingAudio.audioUrl || (!savesTimeline && existingAudio.timelineNeedsReview));

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
                      label: resolveLabel(nextLabel, kind, existingAudio.label),
                      kind,
                      guideRoles: assignment.guideRoles,
                      choirPart: assignment.choirPart,
                      audibleRoles: assignment.audibleRoles,
                      audioUrl: nextAudioUrl,
                      audioFileName:
                        typeof payload.audioFileName === 'string' && payload.audioFileName.trim()
                          ? payload.audioFileName.trim()
                          : existingAudio.audioFileName,
                      contentType:
                        typeof payload.contentType === 'string' && payload.contentType.trim()
                          ? payload.contentType.trim()
                          : existingAudio.contentType,
                      size: typeof payload.size === 'number' ? payload.size : existingAudio.size,
                      timelineCues,
                      timelineNeedsReview,
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
