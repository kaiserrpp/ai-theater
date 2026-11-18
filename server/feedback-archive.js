const storage = require('./shared-storage');

// Explicit, authenticated maintenance only. Normal report reads never list Blob.
// Keep a durable index so retries consume no additional legacy list operations.
const migrateFeedbackArchive = async (namespace, dependencies = {}) => {
  if (!storage.isSupabaseReady()) throw new Error('Activa primero el almacenamiento alternativo.');
  const prefix = `intelligent-feedback/${namespace}/`;
  const checkpointPath = `storage-maintenance/${namespace}/feedback-archive.json`;
  const client = storage.client(), config = storage.configuration();
  const save = async (pathname, value, upsert) => {
    const { error } = await client.from(config.data).upload(pathname, JSON.stringify(value), {
      upsert, contentType: 'application/json', cacheControl: '0',
    });
    if (error) throw error;
  };
  let checkpoint;
  try { checkpoint = await storage.readJson(checkpointPath); }
  catch (error) { if (!error.notFound) throw error; }
  const listLegacy = dependencies.listLegacy || require('@vercel/blob').list;
  const loadPage = async cursor => {
    const result = await listLegacy({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    const records = result.blobs.filter(item => item.pathname.startsWith(prefix) && item.pathname.endsWith('.json'))
      .sort((left, right) => (Date.parse(left.uploadedAt) || 0) - (Date.parse(right.uploadedAt) || 0));
    return { version: 1, namespace, records, offset: 0, cursor: result.cursor || null,
      hasMore: result.hasMore === true, copied: checkpoint?.copied || 0, existing: checkpoint?.existing || 0 };
  };
  if (!checkpoint) {
    checkpoint = await loadPage();
    await save(checkpointPath, checkpoint, false);
  } else if (checkpoint.version !== 1 || checkpoint.namespace !== namespace || !Array.isArray(checkpoint.records) ||
    !Number.isSafeInteger(checkpoint.offset) || checkpoint.offset < 0 || checkpoint.offset > checkpoint.records.length) {
    throw new Error('El índice de informes anteriores está incompleto.');
  }
  if (checkpoint.offset === checkpoint.records.length && checkpoint.hasMore) {
    if (!checkpoint.cursor) throw new Error('Falta la continuación del índice de informes.');
    checkpoint = await loadPage(checkpoint.cursor);
    await save(checkpointPath, checkpoint, true);
  }
  const end = Math.min(checkpoint.offset + 5, checkpoint.records.length);
  for (let index = checkpoint.offset; index < end; index++) {
    const record = checkpoint.records[index];
    const url = new URL(record.url);
    if (!record.pathname.startsWith(prefix) || !record.pathname.endsWith('.json') || record.pathname.includes('..') ||
      url.protocol !== 'https:' || !/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/.test(url.hostname) ||
      url.username || url.password || decodeURIComponent(url.pathname) !== `/${record.pathname}`) {
      throw new Error('La ruta de un informe anterior no es válida.');
    }
    try { await storage.readJson(record.pathname); checkpoint.existing++; continue; }
    catch (error) { if (!error.notFound) throw error; }
    const response = await (dependencies.fetchLegacy || fetch)(url.href, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('No se pudo recuperar un informe anterior.');
    const text = await response.text();
    if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('El informe anterior supera el tamaño permitido.');
    const report = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (!report || typeof report.sessionId !== 'string' || !Array.isArray(report.entries) || report.environment !== namespace) {
      throw new Error('El informe anterior no corresponde al entorno solicitado.');
    }
    await save(record.pathname, report, false);
    if (JSON.stringify(await storage.readJson(record.pathname)) !== JSON.stringify(report)) {
      throw new Error('La copia del informe anterior no coincide.');
    }
    checkpoint.copied++;
  }
  checkpoint.offset = end;
  await save(checkpointPath, checkpoint, true);
  const complete = end === checkpoint.records.length && !checkpoint.hasMore;
  return { ok: true, namespace, copied: checkpoint.copied, existing: checkpoint.existing,
    remainingInPage: checkpoint.records.length - end, complete,
    ...(end === checkpoint.records.length ? { reports: checkpoint.records.map(({ pathname, uploadedAt, size }) => ({ pathname, uploadedAt, size })) } : {}),
    originalsDeleted: 0 };
};

module.exports = { migrateFeedbackArchive };
