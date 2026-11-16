const storage = require('./shared-storage');
const { getStorageNamespace, getSongAdminPasswordFromRequest, isAuthorizedSongAdminRequest } = require('../api/shared-script/_shared');
const { getPublishedLibrary } = require('./library-rescue');

module.exports = async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') return response.status(405).json({ error: 'Método no permitido.' });
  if (!isAuthorizedSongAdminRequest(request, getSongAdminPasswordFromRequest(request))) {
    return response.status(401).json({ error: 'Accede como administrador para preparar el almacenamiento.' });
  }
  try {
    const config = storage.configuration(), client = storage.client();
    for (const [name, isPublic, size, types] of [
      [config.media, true, storage.MAX_UPLOAD_BYTES, ['audio/*', 'video/*', 'image/*']],
      [config.data, false, 4 * 1024 * 1024, ['application/json']],
    ]) {
      const current = await client.getBucket(name);
      if (!current.error) {
        if (current.data.public !== isPublic || Number(current.data.file_size_limit) !== size) throw new Error('Revisa la configuración de los contenedores antes de continuar.');
        continue;
      }
      if (Number(current.error.statusCode) !== 404 && current.error.status !== 404) throw current.error;
      const { error } = await client.createBucket(name, { public: isPublic, fileSizeLimit: size, allowedMimeTypes: types });
      if (error) throw error;
    }
    const namespace = getStorageNamespace(), library = getPublishedLibrary(namespace);
    let seeded = 0;
    for (const [shareId, work] of Object.entries(library?.works || {})) {
      for (const [pathname, value] of [
        [`shared-scripts/${namespace}/${shareId}/manifest.json`, work.manifest],
        [`shared-scripts/${namespace}/${shareId}/warmups/catalog.json`, work.warmup],
      ]) {
        try { await storage.readJson(pathname); continue; }
        catch (error) { if (!error.notFound) throw error; }
        const { error } = await client.from(config.data).upload(pathname, JSON.stringify(value), {
          upsert: false, contentType: 'application/json', cacheControl: '0',
        });
        if (error) throw error;
        const saved = await storage.readJson(pathname);
        if (JSON.stringify(saved) !== JSON.stringify(value)) throw new Error('La comprobación del catálogo no coincide.');
        seeded++;
      }
    }
    return response.status(200).json({ ok: true, namespace, seeded, mediaFilesCopied: 0 });
  } catch {
    return response.status(503).json({ error: 'No se pudo preparar el almacenamiento alternativo. Se conserva la protección y los materiales publicados.' });
  }
};
