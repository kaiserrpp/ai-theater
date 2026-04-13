const {
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

  if (!hasSongAdminPasswordConfigured()) {
    response.status(500).json({ error: 'Falta configurar SONG_ADMIN_PASSWORD en Vercel.' });
    return;
  }

  try {
    const payload = parseJsonBody(request);
    const password = typeof payload.password === 'string' ? payload.password : '';

    if (!isValidSongAdminPassword(password)) {
      response.status(401).json({ error: 'Password incorrecta.' });
      return;
    }

    response.status(200).json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo validar la password.';
    response.status(500).json({ error: message });
  }
};
