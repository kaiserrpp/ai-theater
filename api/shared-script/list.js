const { hasSharedStorage } = require('../../server/shared-storage');
const { listSharedScriptSummaries, getStorageNamespace } = require('./_shared');
const { getProtectedLibrary } = require('../../server/library-rescue');

module.exports = async (request, response) => {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Metodo no permitido.' });
    return;
  }

  if (!hasSharedStorage() && !getProtectedLibrary(getStorageNamespace())) {
    response.status(500).json({ error: 'Falta configurar BLOB_READ_WRITE_TOKEN en Vercel.' });
    return;
  }

  try {
    const scripts = await listSharedScriptSummaries();
    response.status(200).json(scripts);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudieron cargar las obras compartidas.';
    response.status(500).json({ error: message });
  }
};
