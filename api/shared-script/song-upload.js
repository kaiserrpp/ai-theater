const { handleUpload } = require('@vercel/blob/client');
const sharedStorage = require('../../server/shared-storage');
const { assertStorageWritable } = require('../../server/library-rescue');
const {
  getSongAdminPasswordFromRequest,
  hasSongAdminPasswordConfigured,
  isAuthorizedSongAdminRequest,
  parseJsonBody,
  getStorageNamespace,
} = require('./_shared');

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

module.exports = async (request, response) => {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Metodo no permitido.' });
    return;
  }

  if (!sharedStorage.hasSharedStorage()) {
    response.status(500).json({ error: 'Falta configurar BLOB_READ_WRITE_TOKEN en Vercel.' });
    return;
  }

  if (!hasSongAdminPasswordConfigured()) {
    response.status(500).json({ error: 'Falta configurar SONG_ADMIN_PASSWORD en Vercel.' });
    return;
  }

  try {
    const body = parseJsonBody(request);
    if (sharedStorage.usesSupabase()) {
      if (!isAuthorizedSongAdminRequest(request, getSongAdminPasswordFromRequest(request))) {
        response.status(401).json({ error: 'Password incorrecta.' }); return;
      }
      if (body.type !== 'blob.generate-client-token') { response.status(400).json({ error: 'Solicitud de subida no válida.' }); return; }
      const metadata = JSON.parse(body.payload?.clientPayload || '{}');
      const upload = await sharedStorage.createUploadGrant({ ...metadata, pathname: body.payload?.pathname,
        size: body.payload?.size, contentType: body.payload?.contentType }, getStorageNamespace());
      response.status(200).json({ upload }); return;
    }
    const result = await handleUpload({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      request,
      body,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const password = getSongAdminPasswordFromRequest(request);

        if (!isAuthorizedSongAdminRequest(request, password)) {
          throw new Error('Password incorrecta.');
        }
        assertStorageWritable(getStorageNamespace());

        let metadata = {};

        if (typeof clientPayload === 'string' && clientPayload.trim()) {
          metadata = JSON.parse(clientPayload);
        }

        return {
          allowedContentTypes: ['audio/*', 'video/*'],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          allowOverwrite: true,
          tokenPayload: JSON.stringify(metadata),
        };
      },
    });

    response.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo preparar la subida del audio.';
    response.status(message === 'Password incorrecta.' ? 401 : 500).json({ error: message });
  }
};
