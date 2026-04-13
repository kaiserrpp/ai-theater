const { handleUpload } = require('@vercel/blob/client');
const {
  getSongAdminPasswordFromRequest,
  hasSongAdminPasswordConfigured,
  isValidSongAdminPassword,
  parseJsonBody,
} = require('./_shared');

module.exports = async (request, response) => {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Metodo no permitido.' });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    response.status(500).json({ error: 'Falta configurar BLOB_READ_WRITE_TOKEN en Vercel.' });
    return;
  }

  if (!hasSongAdminPasswordConfigured()) {
    response.status(500).json({ error: 'Falta configurar SONG_ADMIN_PASSWORD en Vercel.' });
    return;
  }

  try {
    const body = parseJsonBody(request);
    const result = await handleUpload({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      request,
      body,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const password = getSongAdminPasswordFromRequest(request);

        if (!isValidSongAdminPassword(password)) {
          throw new Error('Password incorrecta.');
        }

        let metadata = {};

        if (typeof clientPayload === 'string' && clientPayload.trim()) {
          metadata = JSON.parse(clientPayload);
        }

        return {
          allowedContentTypes: ['audio/*'],
          maximumSizeInBytes: 100 * 1024 * 1024,
          allowOverwrite: true,
          tokenPayload: JSON.stringify(metadata),
        };
      },
      onUploadCompleted: async () => {},
    });

    response.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo preparar la subida del audio.';
    response.status(message === 'Password incorrecta.' ? 401 : 500).json({ error: message });
  }
};
