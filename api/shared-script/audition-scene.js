const { hasSongAdminPasswordConfigured, isAuthorizedSongAdminRequest, parseJsonBody, readManifest, writeManifest } = require('./_shared');
const handleMusicalAudition = require('../../server/musical-audition');
const { validateAuditionScript, normalizeAuditionScript } = require('../../shared/auditionScenes');

module.exports = async (request, response) => {
  if (request.query?.auditionType === 'music') return handleMusicalAudition(request, response);
  if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'POST, PATCH, DELETE');
    return response.status(405).json({ error: 'Método no permitido.' });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN || !hasSongAdminPasswordConfigured()) {
    return response.status(500).json({ error: 'Falta configurar el almacenamiento o la clave de gestión.' });
  }
  let payload;
  try { payload = parseJsonBody(request); }
  catch { return response.status(400).json({ error: 'Los datos recibidos no son válidos.' }); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return response.status(400).json({ error: 'Los datos recibidos no son válidos.' });
  }
  if (!isAuthorizedSongAdminRequest(request, payload.password)) return response.status(401).json({ error: 'El acceso de administración ha caducado. Vuelve a introducir la clave.' });
  if (typeof payload.shareId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(payload.shareId)) {
    return response.status(400).json({ error: 'Falta identificar la obra.' });
  }
  if (request.method !== 'DELETE') {
    if (typeof payload.title !== 'string' || !payload.title.trim() || payload.title.length > 160) {
      return response.status(400).json({ error: 'Pon un título al mini-guion (máximo 160 caracteres).' });
    }
    const error = validateAuditionScript(payload.scriptData);
    if (error) return response.status(400).json({ error });
  }
  try {
    const manifest = await readManifest(payload.shareId);
    const scenes = manifest.auditionScenes || [];
    const existing = scenes.find((scene) => scene.id === payload.sceneId);
    if (request.method !== 'POST') {
      if (!existing) return response.status(404).json({ error: 'La escena de audición ya no existe. Actualiza la obra.' });
      if (payload.revision !== existing.revision) {
        return response.status(409).json({ error: 'La escena ha cambiado. Actualiza las audiciones antes de volver a editarla.' });
      }
    }
    const now = new Date().toISOString();
    if (request.method === 'DELETE') {
      return response.status(200).json(await writeManifest({ ...manifest,
        auditionScenes: scenes.filter((scene) => scene.id !== existing.id), updatedAt: now }));
    }
    const title = payload.title.trim();
    const scriptData = normalizeAuditionScript(payload.scriptData, title);
    const changedText = existing && JSON.stringify(existing.scriptData.guion) !== JSON.stringify(scriptData.guion);
    const next = {
      id: existing?.id || `audition-${crypto.randomUUID()}`,
      title,
      fileName: typeof payload.fileName === 'string' ? payload.fileName.slice(0, 255) : null,
      scriptData,
      revision: existing ? existing.revision + (changedText ? 1 : 0) : 1,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    return response.status(200).json(await writeManifest({ ...manifest,
      auditionScenes: existing ? scenes.map((scene) => scene.id === existing.id ? next : scene) : [...scenes, next],
      updatedAt: now,
    }));
  } catch (error) {
    return response.status(500).json({ error: error instanceof Error ? error.message : 'No se pudo guardar la escena de audición.' });
  }
};
