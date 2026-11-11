const { put } = require('@vercel/blob');
const { getStorageNamespace, hasSongAdminPasswordConfigured, isAuthorizedSongAdminRequest,
  parseJsonBody, readManifest, writeManifest } = require('../api/shared-script/_shared');
const { normalizeBackgroundMetadata, normalizeSharedAppearance } = require('../shared/workAppearance');

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const decodeImage = (value) => {
  if (typeof value !== 'string' || value.length > MAX_IMAGE_BYTES * 4 / 3 + 100) return null;
  const match = /^data:image\/(jpeg|png|webp);base64,([a-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
  const kind = match[1].toLowerCase();
  const signature = kind === 'jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) :
    kind === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) :
      bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  return signature ? { bytes, kind, contentType: `image/${kind}` } : null;
};

module.exports = async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, DELETE');
    response.status(405).json({ error: 'Método no permitido.' }); return;
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    response.status(500).json({ error: 'Falta configurar el almacenamiento.' }); return;
  }
  try {
    const payload = request.method === 'GET' ? request.query : parseJsonBody(request);
    if (request.method !== 'GET') {
      if (!hasSongAdminPasswordConfigured()) {
        response.status(500).json({ error: 'Falta configurar la clave de gestión.' }); return;
      }
      if (!isAuthorizedSongAdminRequest(request, payload.password)) {
        response.status(401).json({ error: 'El acceso de administración ha caducado. Introduce la clave para continuar.' }); return;
      }
    }
    const shareId = typeof payload.shareId === 'string' ? payload.shareId.trim() : '';
    if (!/^[a-z0-9_-]{1,80}$/i.test(shareId)) {
      response.status(400).json({ error: 'Falta identificar la obra compartida.' }); return;
    }
    const manifest = await readManifest(shareId);
    const previous = normalizeSharedAppearance(manifest.appearance);
    if (request.method === 'GET') { response.status(200).json(previous); return; }
    if (!Number.isSafeInteger(payload.revision) || payload.revision !== previous.revision) {
      response.status(409).json({ error: 'El fondo ha cambiado en otro dispositivo. Se ha recuperado su versión actual; vuelve a intentarlo.' }); return;
    }
    let background = null;
    if (request.method === 'POST') {
      const metadata = normalizeBackgroundMetadata(payload.background);
      const image = decodeImage(payload.background?.dataUrl);
      if (!metadata || !image) {
        response.status(400).json({ error: 'Elige una imagen JPG, PNG o WebP. La imagen preparada debe ocupar menos de 3 MB.' }); return;
      }
      const path = `shared-scripts/${getStorageNamespace()}/${shareId}/appearance/${crypto.randomUUID()}.${image.kind === 'jpeg' ? 'jpg' : image.kind}`;
      const blob = await put(path, image.bytes, { access: 'public', addRandomSuffix: false, contentType: image.contentType });
      background = { uri: blob.url, ...metadata };
    }
    const now = new Date().toISOString();
    const appearance = { revision: previous.revision + 1, background, updatedAt: now };
    // Uploading an image must not restore an old copy of the songs or scenes.
    const latest = request.method === 'POST' ? await readManifest(shareId) : manifest;
    if (normalizeSharedAppearance(latest.appearance).revision !== previous.revision) {
      response.status(409).json({ error: 'El fondo ha cambiado en otro dispositivo. Vuelve a intentarlo.' }); return;
    }
    const saved = await writeManifest({ ...latest, appearance, updatedAt: now });
    response.status(200).json(saved.appearance);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo guardar el fondo de la obra.';
    response.status(message.toLowerCase().includes('not found') ? 404 : 500).json({ error: message });
  }
};
