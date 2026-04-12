const { readManifest } = require('./_shared');

module.exports = async (request, response) => {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Metodo no permitido.' });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    response.status(500).json({ error: 'Falta configurar BLOB_READ_WRITE_TOKEN en Vercel.' });
    return;
  }

  const shareId =
    typeof request.query.shareId === 'string' && request.query.shareId.trim()
      ? request.query.shareId.trim()
      : null;

  if (!shareId) {
    response.status(400).json({ error: 'Debes indicar un shareId.' });
    return;
  }

  try {
    const manifest = await readManifest(shareId);
    response.status(200).json(manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo cargar la obra compartida.';
    const statusCode = message.toLowerCase().includes('not found') ? 404 : 500;
    response.status(statusCode).json({ error: statusCode === 404 ? 'No existe esa obra compartida.' : message });
  }
};
