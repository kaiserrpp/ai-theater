const { head, put } = require('@vercel/blob');
const { getStorageNamespace, isAuthorizedSongAdminRequest, getSongAdminPasswordFromRequest, parseJsonBody } = require('../api/shared-script/_shared');
const { validateWarmupCatalog } = require('../shared/warmupCatalog');

module.exports = async (request, response) => {
  if (request.method === 'POST') {
    if (!isAuthorizedSongAdminRequest(request, getSongAdminPasswordFromRequest(request))) { response.status(401).json({ error: 'Accede como administrador para guardar el calentamiento.' }); return; }
    try {
      const payload = parseJsonBody(request);
      const shareId = payload.shareId;
      if (typeof shareId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(shareId)) { response.status(400).json({ error: 'Obra no válida.' }); return; }
      const catalog = payload.catalog;
      const error = validateWarmupCatalog(catalog);
      if (error) { response.status(400).json({ error }); return; }
      const prefix = `shared-scripts/${getStorageNamespace()}/${shareId}/warmups/`;
      const audios = catalog.exercises.flatMap(exercise => [exercise.explanation, ...Object.values(exercise.piano), ...exercise.cues.map(cue => cue.audio)]);
      const inStorage = audios.every(audio => {
        const url = new URL(audio.audioUrl);
        return url.hostname.endsWith('.public.blob.vercel-storage.com') && decodeURIComponent(url.pathname).startsWith(`/${prefix}`);
      });
      if (!inStorage) { response.status(400).json({ error: 'Los audios deben pertenecer al almacenamiento de esta obra y entorno.' }); return; }
      await put(`${prefix}catalog.json`, JSON.stringify(catalog), { access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
      response.status(200).json({ catalog });
    } catch { response.status(503).json({ error: 'No se pudo guardar el calentamiento. Conserva el paquete preparado y vuelve a intentarlo.' }); }
    return;
  }
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET, POST'); response.status(405).json({ error: 'Método no permitido.' }); return; }
  const shareId = typeof request.query?.shareId === 'string' ? request.query.shareId : '';
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(shareId)) { response.status(400).json({ error: 'Elige una obra compartida para abrir su calentamiento.' }); return; }
  try {
    const blob = await head(`shared-scripts/${getStorageNamespace()}/${shareId}/warmups/catalog.json`);
    const readUrl = new URL(blob.url);
    readUrl.searchParams.set('_ts', String(Date.now()));
    const remote = await fetch(readUrl.toString(), { cache: 'no-store' });
    if (!remote.ok) throw new Error('read failed');
    const catalog = await remote.json();
    const error = validateWarmupCatalog(catalog);
    if (error) throw new Error(error);
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({ catalog });
  } catch (error) {
    if (error?.name === 'BlobNotFoundError' || error?.constructor?.name === 'BlobNotFoundError') {
      response.status(200).json({ catalog: null }); return;
    }
    response.status(503).json({ error: 'No se pudo cargar el calentamiento. Vuelve a intentarlo.' });
  }
};
