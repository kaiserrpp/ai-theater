const { getStorageNamespace } = require('./_shared');

module.exports = async (request, response) => {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Metodo no permitido.' });
    return;
  }

  response.status(200).json({
    namespace: getStorageNamespace(),
  });
};
