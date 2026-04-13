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

  if (!hasSongAdminPasswordConfigured()) {
    response.status(500).json({ error: 'Falta configurar SONG_ADMIN_PASSWORD en Vercel.' });
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
    const audioUrl = typeof payload.audioUrl === 'string' ? payload.audioUrl.trim() : '';

    if (!shareId || !songId || !audioUrl) {
      response.status(400).json({ error: 'Faltan datos para registrar el audio.' });
      return;
    }

    const manifest = await readManifest(shareId);
    const songIndex = manifest.songs.findIndex((song) => song.id === songId);

    if (songIndex === -1) {
      response.status(404).json({ error: 'No existe esa cancion en la obra compartida.' });
      return;
    }

    const now = new Date().toISOString();
    const label =
      typeof payload.label === 'string' && payload.label.trim()
        ? payload.label.trim()
        : AUDIO_KINDS.has(payload.kind) && payload.kind === 'vocal_guide'
          ? 'Vocal guide'
          : 'Karaoke';
    const kind = AUDIO_KINDS.has(payload.kind) ? payload.kind : 'karaoke';

    const nextAudio = {
      id: `audio-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`,
      label,
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

    const songs = manifest.songs.map((song, index) =>
      index === songIndex
        ? {
            ...song,
            audios: [nextAudio, ...song.audios],
            updatedAt: now,
          }
        : song
    );

    const updatedManifest = await writeManifest({
      ...manifest,
      songs,
      updatedAt: now,
    });

    response.status(200).json(updatedManifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo registrar el audio de la cancion.';
    response.status(500).json({ error: message });
  }
};
