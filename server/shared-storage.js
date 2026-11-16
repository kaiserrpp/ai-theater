const { StorageClient } = require('@supabase/storage-js');

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const usesSupabase = () => process.env.SHARED_STORAGE_PROVIDER === 'supabase';
const configuration = () => {
  const raw = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  let url;
  try { url = new URL(raw); } catch { throw new Error('Falta configurar la URL del almacenamiento alternativo.'); }
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !key) {
    throw new Error('La configuración del almacenamiento alternativo está incompleta.');
  }
  return { url: url.origin, key, media: 'theatre-media', data: 'theatre-data' };
};
const isSupabaseReady = () => { try { return usesSupabase() && Boolean(configuration()); } catch { return false; } };
const hasSharedStorage = () => usesSupabase() ? isSupabaseReady() : Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const client = () => {
  const config = configuration();
  return new StorageClient(`${config.url}/storage/v1`, { Authorization: `Bearer ${config.key}`, apikey: config.key });
};
const validPath = value => typeof value === 'string' && value.length < 1000 &&
  /^[a-zA-Z0-9/_\-.]+$/.test(value) && !value.includes('..') && !value.startsWith('/') && !value.includes('//');
const checkPath = value => { if (!validPath(value)) throw new Error('Ruta de almacenamiento no válida.'); return value; };
const bucket = pathname => pathname.endsWith('.json') ? configuration().data : configuration().media;
const storageError = error => {
  const result = new Error('No se pudo acceder al almacenamiento alternativo. Conserva los cambios y vuelve a intentarlo.');
  result.status = Number(error?.status || error?.statusCode);
  result.notFound = result.status === 404 || Number(error?.statusCode) === 404 || error?.code === 'NoSuchKey' || error?.error === 'not_found';
  return result;
};
const publicMediaUrl = pathname => client().from(configuration().media).getPublicUrl(checkPath(pathname)).data.publicUrl;
const isMediaUrl = (value, prefix = '') => {
  try {
    const config = configuration(), url = new URL(value);
    const root = `/storage/v1/object/public/${config.media}/`;
    if (url.origin !== config.url || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(root)) return false;
    const pathname = decodeURIComponent(url.pathname.slice(root.length));
    return validPath(pathname) && pathname.startsWith(prefix);
  } catch { return false; }
};
const readJson = async pathname => {
  const { data, error } = await client().from(configuration().data).download(checkPath(pathname), {}, { cache: 'no-store' });
  if (error) throw storageError(error);
  try { return JSON.parse(await data.text()); } catch { throw new Error('Los datos compartidos recibidos están incompletos.'); }
};
const put = async (pathname, body, options = {}) => {
  checkPath(pathname);
  const { error } = await client().from(bucket(pathname)).upload(pathname, body, {
    upsert: options.allowOverwrite === true, contentType: options.contentType,
    cacheControl: pathname.endsWith('.json') ? '0' : '31536000',
  });
  if (error) throw storageError(error);
  // Private JSON never receives a public URL or an exposed service credential.
  return { pathname, url: pathname.endsWith('.json') ? '' : publicMediaUrl(pathname) };
};
const list = async ({ prefix, limit = 200 }) => {
  checkPath(prefix);
  const queue = [prefix.replace(/\/$/, '')], blobs = [];
  while (queue.length) {
    const folder = queue.shift();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client().from(configuration().data).list(folder, {
        limit: 1000, offset, sortBy: { column: 'updated_at', order: 'desc' },
      });
      if (error) throw storageError(error);
      for (const item of data) {
        const pathname = `${folder}/${item.name}`;
        if (!validPath(pathname)) continue;
        if (!item.id) queue.push(pathname);
        else if (pathname.endsWith('.json')) blobs.push({ pathname, url: '',
          size: Number(item.metadata?.size) || 0, uploadedAt: item.updated_at || item.created_at });
      }
      if (data.length < 1000) break;
    }
  }
  blobs.sort((a, b) => (Date.parse(b.uploadedAt) || 0) - (Date.parse(a.uploadedAt) || 0));
  return { blobs: blobs.slice(0, limit), hasMore: blobs.length > limit };
};
const del = async pathname => {
  checkPath(pathname);
  const { error } = await client().from(bucket(pathname)).remove([pathname]);
  if (error) throw storageError(error);
};
// Capture the legacy SDK at module load so existing callers/tests keep their
// adapter. A selected alternative never retries a failed operation in Blob.
const selectStorage = fallback => ({
  put: (...args) => usesSupabase() ? put(...args) : fallback.put(...args),
  list: (...args) => usesSupabase() ? list(...args) : fallback.list(...args),
  del: (...args) => usesSupabase() ? del(...args) : fallback.del(...args),
  head: (...args) => {
    if (usesSupabase()) throw new Error('Usa la lectura privada de datos del almacenamiento alternativo.');
    return fallback.head(...args);
  },
});
const createUploadGrant = async ({ pathname, size, contentType, shareId, targetId, targetType }, namespace) => {
  const folders = { song: 'songs', 'musical-number': 'musical-numbers', 'musical-audition': 'musical-auditions', warmup: 'warmups' };
  const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
  if (!id(shareId) || !id(targetId) || !folders[targetType] || !validPath(pathname) ||
    !pathname.startsWith(`shared-scripts/${namespace}/${shareId}/${folders[targetType]}/${targetId}/`) ||
    !Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES ||
    typeof contentType !== 'string' || !/^(audio|video)\/[a-zA-Z0-9.+-]+$/.test(contentType)) {
    throw new Error('La subida no es válida. El plan gratuito admite archivos de hasta 50 MB.');
  }
  const { data, error } = await client().from(configuration().media).createSignedUploadUrl(pathname, { upsert: false });
  if (error) throw storageError(error);
  return { provider: 'supabase', signedUrl: data.signedUrl, publicUrl: publicMediaUrl(pathname), pathname, maximumSizeInBytes: MAX_UPLOAD_BYTES };
};
module.exports = { usesSupabase, isSupabaseReady, hasSharedStorage, configuration, client, readJson, selectStorage,
  publicMediaUrl, isMediaUrl, createUploadGrant, MAX_UPLOAD_BYTES };
