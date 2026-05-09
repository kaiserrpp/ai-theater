const { put } = require('@vercel/blob');
const { getStorageNamespace, parseJsonBody } = require('./_shared');

const MAX_ENTRIES = 500;
const MAX_TEXT_LENGTH = 1200;

const sanitizePathPart = (value, fallback) =>
  String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || fallback;

const clampText = (value) =>
  typeof value === 'string' ? value.trim().slice(0, MAX_TEXT_LENGTH) : '';

const normalizeStringArray = (value) =>
  Array.isArray(value)
    ? Array.from(new Set(value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean)))
    : [];

const normalizeEntry = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const expectedText = clampText(entry.expectedText);
  const heardText = clampText(entry.heardText);

  if (!expectedText && !heardText) {
    return null;
  }

  return {
    lineIndex: typeof entry.lineIndex === 'number' ? entry.lineIndex : -1,
    character: clampText(entry.character).slice(0, 120),
    sceneTitle: typeof entry.sceneTitle === 'string' ? clampText(entry.sceneTitle).slice(0, 180) : null,
    expectedText,
    heardText,
    score: typeof entry.score === 'number' ? Math.max(0, Math.min(1, entry.score)) : 0,
    result: clampText(entry.result).slice(0, 60),
    matchedReferenceText: clampText(entry.matchedReferenceText),
    matchedReferenceIndex:
      typeof entry.matchedReferenceIndex === 'number' ? entry.matchedReferenceIndex : 0,
    language: clampText(entry.language).slice(0, 24),
    createdAt:
      typeof entry.createdAt === 'string' && entry.createdAt.trim()
        ? entry.createdAt.trim()
        : new Date().toISOString(),
  };
};

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

  try {
    const payload = parseJsonBody(request);
    const sessionId = sanitizePathPart(payload.sessionId, crypto.randomUUID());
    const scriptId = sanitizePathPart(payload.scriptId, 'script');
    const entries = Array.isArray(payload.entries)
      ? payload.entries.slice(0, MAX_ENTRIES).map(normalizeEntry).filter(Boolean)
      : [];

    if (!entries.length) {
      response.status(400).json({ error: 'No hay resultados de prueba para enviar.' });
      return;
    }

    const body = {
      version: 1,
      environment: getStorageNamespace(),
      sessionId,
      scriptId,
      shareId: typeof payload.shareId === 'string' ? payload.shareId.trim() || null : null,
      scriptTitle: clampText(payload.scriptTitle).slice(0, 180),
      appVersion: clampText(payload.appVersion).slice(0, 40),
      userRoles: normalizeStringArray(payload.userRoles).slice(0, 80),
      userAgent: typeof payload.userAgent === 'string' ? clampText(payload.userAgent).slice(0, 280) : null,
      entryCount: entries.length,
      entries,
      createdAt: new Date().toISOString(),
    };
    const pathname = `intelligent-feedback/${body.environment}/${scriptId}/${sessionId}.json`;
    const blob = await put(pathname, JSON.stringify(body, null, 2), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json; charset=utf-8',
    });

    response.status(200).json({
      ok: true,
      url: blob.url,
      entryCount: entries.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo guardar el informe.';
    response.status(500).json({ error: message });
  }
};
