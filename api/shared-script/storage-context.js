const { getStorageNamespace } = require('./_shared');
const { getProtectedLibrary } = require('../../server/library-rescue');
const sharedStorage = require('../../server/shared-storage');

module.exports = async (request, response) => {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Metodo no permitido.' });
    return;
  }

  response.status(200).json({
    namespace: getStorageNamespace(),
    ...(sharedStorage.usesSupabase() ? { provider: 'supabase', maximumUploadBytes: sharedStorage.MAX_UPLOAD_BYTES } : {}),
    ...(getProtectedLibrary(getStorageNamespace()) ? { readOnly: true,
      message: 'Puedes seguir ensayando. Las nuevas subidas y los cambios compartidos están temporalmente protegidos hasta conectar el almacenamiento alternativo.' } : {}),
  });
};
