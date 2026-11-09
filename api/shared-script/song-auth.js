const {
  hasSongAdminPasswordConfigured,
  isValidSongAdminPassword,
  getStorageNamespace,
  parseJsonBody,
} = require('./_shared');
const { isAllowedOrigin, readAdminSession, issueAdminSession, clearAdminSession } = require('../../server/admin-session');

module.exports = async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Cookie');
  if (!['GET', 'POST', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST, DELETE');
    response.status(405).json({ error: 'Metodo no permitido.' });
    return;
  }

  if (!isAllowedOrigin(request)) return response.status(403).json({ error: 'El origen de la solicitud no está autorizado.' });
  if (request.method === 'DELETE' && request.headers?.['x-ai-theatre-admin'] !== '1') {
    return response.status(403).json({ error: 'Vuelve a abrir el acceso de administración desde la app.' });
  }
  if (request.method === 'DELETE') {
    clearAdminSession(request, response);
    return response.status(200).json({ authenticated: false });
  }

  if (!hasSongAdminPasswordConfigured()) {
    response.status(500).json({ error: 'Falta configurar SONG_ADMIN_PASSWORD en Vercel.' });
    return;
  }

  try {
    if (request.method === 'GET') {
      const session = readAdminSession(request, getStorageNamespace());
      if (!session) {
        if (request.headers?.cookie) clearAdminSession(request, response);
        return response.status(200).json({ authenticated: false });
      }
      return response.status(200).json({ authenticated: true, remembered: session.remember, expiresAt: session.exp * 1000 });
    }
    const payload = parseJsonBody(request);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || (payload.remember !== undefined && typeof payload.remember !== 'boolean')) {
      return response.status(400).json({ error: 'Los datos de acceso no son válidos.' });
    }
    const password = typeof payload.password === 'string' ? payload.password : '';

    if (!isValidSongAdminPassword(password)) {
      response.status(401).json({ error: 'La clave de gestión no es correcta.' });
      return;
    }

    const session = issueAdminSession(request, response, getStorageNamespace(), payload.remember !== false);
    response.status(200).json({ ok: true, authenticated: true, remembered: session.remember, expiresAt: session.exp * 1000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo validar la password.';
    response.status(500).json({ error: message });
  }
};
