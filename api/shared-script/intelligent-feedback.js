const { head, list, put } = require('@vercel/blob');
const {
  getSongAdminPasswordFromRequest,
  getStorageNamespace,
  hasSongAdminPasswordConfigured,
  isValidSongAdminPassword,
  parseJsonBody,
} = require('./_shared');

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

const normalizeIssueType = (value) => {
  const issueType = clampText(value).slice(0, 60);

  return ['corto_antes_de_tiempo', 'dije_mal_mi_frase', 'otro'].includes(issueType)
    ? issueType
    : null;
};

const clampScore = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : null;

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
    coverageScore: clampScore(entry.coverageScore),
    orderScore: clampScore(entry.orderScore),
    finalScore: clampScore(entry.finalScore),
    finalPhraseScore: clampScore(entry.finalPhraseScore),
    finalPhraseWordCount:
      typeof entry.finalPhraseWordCount === 'number' && Number.isFinite(entry.finalPhraseWordCount)
        ? Math.max(0, Math.min(12, Math.round(entry.finalPhraseWordCount)))
        : null,
    precisionScore: clampScore(entry.precisionScore),
    negationPenaltyApplied:
      typeof entry.negationPenaltyApplied === 'boolean' ? entry.negationPenaltyApplied : null,
    autoAdvanceReason: clampText(entry.autoAdvanceReason).slice(0, 60) || null,
    result: clampText(entry.result).slice(0, 60),
    matchedReferenceText: clampText(entry.matchedReferenceText),
    matchedReferenceIndex:
      typeof entry.matchedReferenceIndex === 'number' ? entry.matchedReferenceIndex : 0,
    language: clampText(entry.language).slice(0, 24),
    issueType: normalizeIssueType(entry.issueType),
    issueNote: typeof entry.issueNote === 'string' ? clampText(entry.issueNote).slice(0, 500) || null : null,
    createdAt:
      typeof entry.createdAt === 'string' && entry.createdAt.trim()
        ? entry.createdAt.trim()
        : new Date().toISOString(),
  };
};

const getPasswordFromRequest = (request) => {
  if (typeof request.query?.password === 'string') {
    return request.query.password;
  }

  return getSongAdminPasswordFromRequest(request);
};

const ensureCanReadFeedback = (request, response) => {
  if (!hasSongAdminPasswordConfigured()) {
    response.status(500).json({ error: 'Falta configurar SONG_ADMIN_PASSWORD en Vercel.' });
    return false;
  }

  if (!isValidSongAdminPassword(getPasswordFromRequest(request))) {
    response.status(401).json({ error: 'Password incorrecta.' });
    return false;
  }

  return true;
};

const buildFeedbackPrefix = () => `intelligent-feedback/${getStorageNamespace()}`;

const readFeedbackBlob = async (pathname) => {
  const blob = await head(pathname);
  const feedbackResponse = await fetch(`${blob.url}${blob.url.includes('?') ? '&' : '?'}_ts=${Date.now()}`, {
    cache: 'no-store',
  });

  if (!feedbackResponse.ok) {
    throw new Error('No se pudo descargar el informe.');
  }

  return feedbackResponse.json();
};

const handleGetFeedback = async (request, response) => {
  if (!ensureCanReadFeedback(request, response)) {
    return;
  }

  const prefix = buildFeedbackPrefix();
  const requestedPathname =
    typeof request.query?.pathname === 'string' && request.query.pathname.trim()
      ? request.query.pathname.trim()
      : '';

  if (requestedPathname) {
    if (!requestedPathname.startsWith(`${prefix}/`) || !requestedPathname.endsWith('.json')) {
      response.status(400).json({ error: 'Ruta de informe no valida.' });
      return;
    }

    const report = await readFeedbackBlob(requestedPathname);
    response.status(200).json({ report });
    return;
  }

  const scriptId =
    typeof request.query?.scriptId === 'string' && request.query.scriptId.trim()
      ? sanitizePathPart(request.query.scriptId, 'script')
      : null;
  const result = await list({
    prefix: scriptId ? `${prefix}/${scriptId}/` : `${prefix}/`,
    limit: 100,
  });
  const reports = result.blobs
    .filter((blob) => blob.pathname.endsWith('.json'))
    .sort((leftBlob, rightBlob) =>
      String(rightBlob.uploadedAt ?? '').localeCompare(String(leftBlob.uploadedAt ?? ''))
    )
    .slice(0, 25)
    .map((blob) => ({
      pathname: blob.pathname,
      uploadedAt: blob.uploadedAt,
      size: blob.size,
      url: blob.url,
    }));

  const latestReport = reports[0] ? await readFeedbackBlob(reports[0].pathname) : null;

  response.status(200).json({
    namespace: getStorageNamespace(),
    count: reports.length,
    reports,
    latestReport,
  });
};

module.exports = async (request, response) => {
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST');
    response.status(405).json({ error: 'Metodo no permitido.' });
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    response.status(500).json({ error: 'Falta configurar BLOB_READ_WRITE_TOKEN en Vercel.' });
    return;
  }

  try {
    if (request.method === 'GET') {
      await handleGetFeedback(request, response);
      return;
    }

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
