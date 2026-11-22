const storage = require('./shared-storage');
const { getStorageNamespace, getSongAdminPasswordFromRequest, isAuthorizedSongAdminRequest } = require('../api/shared-script/_shared');
const { getPublishedLibrary } = require('./library-rescue');

const readStorageUsage = async (client) => {
  const { data: buckets, error } = await client.listBuckets();
  if (error) throw error;
  const usage = await Promise.all(buckets.map(async (bucket) => {
    const files = client.from(bucket.id);
    let bytes = 0;
    let objects = 0;
    let cursor;
    do {
      const { data, error } = await files.listV2({ cursor, noncurrentVersions: 'include' });
      if (error) throw error;
      for (const object of data.objects) {
        const size = object.metadata?.size;
        if (!Number.isSafeInteger(size) || size < 0) throw new Error('Tamaño de archivo no disponible.');
        bytes += size;
        objects += 1;
      }
      if (data.hasNext && (!data.nextCursor || data.nextCursor === cursor)) {
        throw new Error('No se pudo recorrer el almacenamiento.');
      }
      cursor = data.hasNext ? data.nextCursor : undefined;
    } while (cursor);
    return { bucket: bucket.id, bytes, objects };
  }));
  return { bytes: usage.reduce((total, bucket) => total + bucket.bytes, 0), buckets: usage };
};

module.exports = async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') return response.status(405).json({ error: 'Método no permitido.' });
  if (!isAuthorizedSongAdminRequest(request, getSongAdminPasswordFromRequest(request))) {
    return response.status(401).json({ error: 'Accede como administrador para preparar el almacenamiento.' });
  }
  try {
    if (request.query?.action === 'migrate-feedback') {
      return response.status(200).json(await require('./feedback-archive').migrateFeedbackArchive(getStorageNamespace()));
    }
    if (request.query?.action === 'usage') {
      if (!storage.isSupabaseReady()) return response.status(409).json({ error: 'Supabase no está activo en este entorno.' });
      return response.status(200).json(await readStorageUsage(storage.client()));
    }
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
