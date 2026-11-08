const { hasSongAdminPasswordConfigured, isValidSongAdminPassword, parseJsonBody, readManifest, writeManifest } = require('./_shared');
const { normalizeRoles, validateMusicalAudition, validAudioUrl } = require('../../shared/musicalAuditions');

module.exports = async (request, response) => {
  if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'POST, PATCH, DELETE');
    return response.status(405).json({ error: 'Método no permitido.' });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN || !hasSongAdminPasswordConfigured()) return response.status(500).json({ error: 'Falta configurar el almacenamiento o la clave de gestión.' });
  let input;
  try { input = parseJsonBody(request); } catch { return response.status(400).json({ error: 'Los datos recibidos no son válidos.' }); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return response.status(400).json({ error: 'Los datos recibidos no son válidos.' });
  if (!isValidSongAdminPassword(input.password)) return response.status(401).json({ error: 'Clave de gestión incorrecta.' });
  if (typeof input.shareId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.shareId)) return response.status(400).json({ error: 'Falta identificar la obra.' });
  if (input.auditionId != null && (typeof input.auditionId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.auditionId))) return response.status(400).json({ error: 'El identificador del fragmento no es válido.' });
  const operation = input.operation || 'details';
  if (!['details', 'audio', 'remove-audio'].includes(operation)) return response.status(400).json({ error: 'Operación no válida.' });
  if (request.method === 'POST' && operation !== 'details') return response.status(400).json({ error: 'Primero guarda los datos del fragmento.' });
  if (request.method !== 'DELETE' && operation === 'details') {
    const error = validateMusicalAudition(input);
    if (error) return response.status(400).json({ error });
  }
  if (request.method === 'PATCH' && operation !== 'details') {
    if (!['vocal_guide', 'karaoke'].includes(input.kind)) return response.status(400).json({ error: 'Elige Con voz o Karaoke.' });
    if (operation === 'audio' && (!input.audio || !validAudioUrl(input.audio.audioUrl) ||
      (input.audio.contentType && !/^audio\//i.test(input.audio.contentType)) ||
      (input.audio.size != null && (!Number.isFinite(input.audio.size) || input.audio.size < 0 || input.audio.size > 512 * 1024 * 1024)))) {
      return response.status(400).json({ error: 'El archivo de audio recibido no es válido.' });
    }
  }
  try {
    const manifest = await readManifest(input.shareId);
    const cuts = manifest.musicalAuditions || [];
    const existing = cuts.find((cut) => cut.id === input.auditionId);
    const now = new Date().toISOString();
    if (request.method === 'POST' && existing) {
      const number = manifest.musicalNumbers.find((candidate) => candidate.id === existing.musicalNumberId);
      const same = existing.title === input.title.trim() && existing.lyrics === (input.lyrics?.trim() || '') &&
        JSON.stringify(existing.roles) === JSON.stringify(normalizeRoles(input.roles)) &&
        (input.musicalNumberId ? input.musicalNumberId === existing.musicalNumberId : input.musicalNumberTitle?.trim() === number?.title);
      return response.status(same ? 200 : 409).json(same ? manifest : { error: 'El fragmento ya se guardó. Actualiza sus datos antes de volver a guardar.' });
    }
    if (request.method !== 'POST') {
      if (!existing) return response.status(404).json({ error: 'El fragmento ya no existe. Actualiza las canciones.' });
      if (input.revision !== existing.revision) return response.status(409).json({ error: 'El fragmento ha cambiado. Hemos de actualizarlo antes de guardar.' });
    }
    if (request.method === 'DELETE') return response.status(200).json(await writeManifest({ ...manifest,
      musicalAuditions: cuts.filter((cut) => cut.id !== existing.id), updatedAt: now }));
    let next;
    let numbers = manifest.musicalNumbers;
    if (operation === 'details') {
      let number = numbers.find((candidate) => candidate.id === input.musicalNumberId);
      if (input.musicalNumberId && !number) return response.status(400).json({ error: 'El número musical ya no existe. Elige otro o crea uno.' });
      if (!number) {
        if (typeof input.musicalNumberTitle !== 'string' || !input.musicalNumberTitle.trim() || input.musicalNumberTitle.length > 160) return response.status(400).json({ error: 'Elige un número musical o escribe su nombre (máximo 160 caracteres).' });
        number = { id: `musical-number-${crypto.randomUUID()}`, title: input.musicalNumberTitle.trim(), sceneTitle: null,
          startLineIndex: -1, endLineIndex: -1, songIds: [], audios: [], updatedAt: now };
        numbers = [...numbers, number];
      }
      next = { ...existing, id: existing?.id || input.auditionId || `musical-audition-${crypto.randomUUID()}`,
        musicalNumberId: number.id, title: input.title.trim(), roles: normalizeRoles(input.roles), lyrics: input.lyrics?.trim() || '',
        audios: existing?.audios || [], revision: existing ? existing.revision + 1 : 1, createdAt: existing?.createdAt || now, updatedAt: now };
    } else {
      const audios = existing.audios.filter((audio) => audio.kind !== input.kind);
      if (operation === 'audio') audios.push({ id: `${existing.id}:${input.kind}`, kind: input.kind,
        label: input.kind === 'karaoke' ? 'Karaoke' : 'Con voz', guideRoles: existing.roles,
        audioUrl: input.audio.audioUrl.trim(), audioFileName: typeof input.audio.audioFileName === 'string' ? input.audio.audioFileName.slice(0, 255) : null,
        contentType: input.audio.contentType || null, size: input.audio.size ?? null, timelineCues: [], updatedAt: now });
      next = { ...existing, audios, revision: existing.revision + 1, updatedAt: now };
    }
    return response.status(200).json(await writeManifest({ ...manifest, musicalNumbers: numbers,
      musicalAuditions: existing ? cuts.map((cut) => cut.id === next.id ? next : cut) : [...cuts, next], updatedAt: now }));
  } catch (error) { return response.status(500).json({ error: error instanceof Error ? error.message : 'No se pudo guardar el fragmento musical.' }); }
};
