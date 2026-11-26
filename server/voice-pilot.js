const { createHash, timingSafeEqual } = require('node:crypto');
const sharedStorage = require('./shared-storage');
const { getStorageNamespace, parseJsonBody, getSongAdminPasswordFromRequest, isAuthorizedSongAdminRequest } = require('../api/shared-script/_shared');
const { isAllowedOrigin } = require('./admin-session');

const MODEL = 'gpt-live-transcribe';
const LEASE_MS = 45_000;
const LEASE_COUNT = 40;
const REHEARSAL_SLOTS = 4;
const PREFIX = 'voice-pilot/production';
const OPENAI_URL = 'https://api.openai.com/v1/realtime';

const cleanCode = value => typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : '';
const verifyCode = (supplied, expected) => {
  const actual = cleanCode(supplied), required = cleanCode(expected);
  return /^[0-9A-F]{24}$/.test(actual) && /^[0-9A-F]{24}$/.test(required) &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(required));
};

const pathname = slot => `${PREFIX}/${String(slot).padStart(2, '0')}.json`;
const reservedPaths = async storage => {
  const { blobs } = await storage.list({ prefix: PREFIX, limit: LEASE_COUNT });
  return new Set(blobs.map(blob => blob.pathname));
};
const remaining = paths => Array.from({ length: LEASE_COUNT }, (_, slot) => pathname(slot))
  .filter(path => !paths.has(path)).length;

const reserve = async (storage, now, slotsWanted) => {
  const used = await reservedPaths(storage);
  const createdAt = now();
  let slots = 0;
  for (let slot = 0; slot < LEASE_COUNT; slot += 1) {
    const path = pathname(slot);
    if (used.has(path)) continue;
    try {
      await storage.put(path, JSON.stringify({ createdAt, reservedMs: LEASE_MS }), {
        contentType: 'application/json', allowOverwrite: false,
      });
      used.add(path);
      slots += 1;
      if (slots === slotsWanted) break;
    } catch (error) {
      if (error.status !== 409) throw error;
      used.add(path);
    }
  }
  return slots ? { deadline: createdAt + slots * LEASE_MS, remainingSeconds: remaining(used) * LEASE_MS / 1000 } : null;
};

const voicePackPath = ({ share, audition, revision, scene } = {}) => {
  const validId = value => typeof value === 'string' && /^[a-z0-9-]{1,80}$/i.test(value);
  const validNumber = value => typeof value === 'string' && /^\d{1,6}$/.test(value);
  return validId(share) && validId(audition) && validNumber(revision) && validNumber(scene)
    ? `voice-pilot-media/production/${share}/${audition}/${revision}/${scene}.json` : null;
};

const handleVoicePack = async (request, response, storage, canPublish) => {
  const path = voicePackPath(request.query);
  if (!path) return response.status(400).json({ error: 'Selecciona una escena válida.' });
  try {
    if (request.method === 'GET') return response.status(200).json(await storage.readJson(path));
    if (request.method !== 'PUT' || !canPublish(request)) {
      return response.status(403).json({ error: 'La preparación de voces requiere acceso de gestión.' });
    }
    const clips = parseJsonBody(request)?.clips;
    const entries = Object.entries(clips && typeof clips === 'object' && !Array.isArray(clips) ? clips : {});
    if (!entries.length || entries.length > 80 || entries.some(([index, clip]) =>
      !/^\d{1,6}$/.test(index) || typeof clip !== 'string' || clip.length > 400_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clip)
    )) return response.status(400).json({ error: 'La selección de voces no es válida.' });
    const data = JSON.stringify({ clips });
    if (data.length > 3_500_000) return response.status(413).json({ error: 'Las voces superan el tamaño de una escena.' });
    await storage.put(path, data, { contentType: 'application/json', allowOverwrite: false });
    return response.status(201).json({ count: entries.length });
  } catch (error) {
    if (error.status === 409) return response.status(409).json({ error: 'Las voces de esta revisión ya están preparadas.' });
    return response.status(error.notFound ? 404 : 503).json({
      error: error.notFound ? 'Las voces de esta escena aún no están preparadas.' : 'No se pudieron consultar las voces de la escena.',
    });
  }
};

const providerError = async (response, stage) => {
  const body = await response.json().catch(() => null);
  const code = body?.error?.code || body?.error?.type;
  const label = typeof code === 'string' && /^[a-z0-9_-]{1,64}$/i.test(code) ? code : '';
  return Object.assign(new Error('OpenAI no pudo abrir la transcripción en directo.'), {
    provider: { stage, status: response.status, code: label },
  });
};

const negotiate = async (key, offer, safetyId) => {
  const client = await fetch(`${OPENAI_URL}/client_secrets`, {
    method: 'POST', signal: AbortSignal.timeout(7000), redirect: 'error',
    headers: {
      Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      'OpenAI-Safety-Identifier': safetyId,
    },
    body: JSON.stringify({
      expires_after: { anchor: 'created_at', seconds: 20 },
      session: {
        type: 'transcription',
        audio: { input: { transcription: { model: MODEL }, turn_detection: null } },
      },
    }),
  });
  if (!client.ok) throw await providerError(client, 'sesión de transcripción');
  const authorization = (await client.json()).value;
  if (typeof authorization !== 'string' || !authorization.startsWith('ek_')) throw new Error('Falta autorización de sesión.');

  // The short-lived credential stays on our server, as does the durable API key.
  const call = await fetch(`${OPENAI_URL}/calls`, {
    method: 'POST', signal: AbortSignal.timeout(9000), redirect: 'error',
    headers: { Authorization: `Bearer ${authorization}`, 'Content-Type': 'application/sdp' },
    body: offer,
  });
  if (!call.ok) throw await providerError(call, 'conexión de audio');
  const location = call.headers.get('location') || '';
  const callId = new URL(location, OPENAI_URL).pathname.match(/\/calls\/([a-zA-Z0-9_-]{5,120})$/)?.[1];
  if (!callId) throw new Error('OpenAI no identificó la sesión para poder cerrarla.');
  const answer = await call.text();
  if (!answer.startsWith('v=0')) {
    await hangUp(key, callId);
    throw new Error('OpenAI no devolvió una conexión de audio válida.');
  }
  return { callId, answer };
};

const hangUp = async (key, callId) => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await fetch(`${OPENAI_URL}/calls/${callId}/hangup`, {
        method: 'POST', signal: AbortSignal.timeout(2200), redirect: 'error',
        headers: { Authorization: `Bearer ${key}` },
      });
      if (result.ok || result.status === 404) return;
    } catch { /* The peer also closes locally at its deadline. */ }
  }
};

const waitForClose = (response, ms) => new Promise(resolve => {
  const finish = () => { clearTimeout(timer); response.off('close', finish); resolve(); };
  const timer = setTimeout(finish, ms);
  response.once('close', finish);
  if (response.destroyed) finish();
});

const createVoicePilotHandler = ({ settings, storage, now = Date.now, connect = negotiate, disconnect = hangUp,
  canPublish = request => isAuthorizedSongAdminRequest(request, getSongAdminPasswordFromRequest(request)) }) =>
  async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const config = settings();
    if (!config) return response.status(404).json({ error: 'El piloto privado no está disponible.' });
    if (!isAllowedOrigin(request) || !verifyCode(request.headers?.['x-ai-theatre-pilot'], config.code)) {
      return response.status(403).json({ error: 'El código de acceso no es válido.' });
    }
    if (request.query?.action === 'voice-pack') return handleVoicePack(request, response, storage, canPublish);
    if (request.method === 'GET') {
      try {
        const count = remaining(await reservedPaths(storage));
        return response.status(200).json({ remainingSeconds: count * LEASE_MS / 1000,
          attemptSeconds: Math.min(count, REHEARSAL_SLOTS) * LEASE_MS / 1000 });
      } catch {
        return response.status(503).json({ error: 'No se pudo comprobar el tiempo disponible.' });
      }
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return response.status(405).json({ error: 'Método no permitido.' });
    }
    const body = parseJsonBody(request);
    const offer = body?.sdp;
    if (typeof offer !== 'string' || offer.length > 14_000 || !offer.startsWith('v=0') ||
        !/^m=audio /m.test(offer) || !/^m=application /m.test(offer)) {
      return response.status(400).json({ error: 'La conexión de audio no es válida.' });
    }
    let lease, call;
    try {
      lease = await reserve(storage, now, body.rehearsal === true ? REHEARSAL_SLOTS : 1);
      if (!lease) return response.status(409).json({ error: 'Se han reservado los 30 minutos del piloto.' });
      const safetyId = createHash('sha256').update(config.code).digest('hex');
      call = await connect(config.key, offer, safetyId);
      // Leave time for the close request before the reserved interval expires.
      const remainingMs = lease.deadline - now() - 5000;
      if (remainingMs < 5000 || response.destroyed) {
        if (!response.destroyed) response.status(503).json({ error: 'La conexión tardó demasiado en abrirse.' });
        return;
      }
      response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      response.setHeader('X-Accel-Buffering', 'no');
      response.write(`data: ${JSON.stringify({
        answer: call.answer, remainingMs, remainingSeconds: lease.remainingSeconds, model: MODEL,
      })}\n\n`);
      await waitForClose(response, remainingMs);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) {
        return response.status(502).json({
          error: call || lease ? 'No se pudo abrir la transcripción de OpenAI.' : 'No se pudo reservar tiempo para el piloto.',
          ...(error.provider ? { provider: error.provider } : {}),
        });
      }
    } finally {
      if (call) await disconnect(config.key, call.callId);
      if (response.headersSent && !response.destroyed && !response.writableEnded) response.end();
    }
  };

const handler = createVoicePilotHandler({
  settings: () => {
    const key = process.env.AI_THEATRE_OPENAI_PILOT_KEY;
    const code = process.env.AI_THEATRE_VOICE_PILOT_CODE;
    return process.env.VERCEL_ENV === 'production' && getStorageNamespace() === 'production' &&
      key && code && sharedStorage.isSupabaseReady() ? { key, code } : null;
  },
  storage: { ...sharedStorage.selectStorage({}), readJson: sharedStorage.readJson },
});

module.exports = handler;
module.exports.createVoicePilotHandler = createVoicePilotHandler;
