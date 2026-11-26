const { createHash, timingSafeEqual } = require('node:crypto');
const sharedStorage = require('./shared-storage');
const { getStorageNamespace, parseJsonBody } = require('../api/shared-script/_shared');
const { isAllowedOrigin } = require('./admin-session');

const MODEL = 'gpt-live-transcribe';
const LEASE_MS = 45_000;
const LEASE_COUNT = 40;
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

const reserve = async (storage, now) => {
  const used = await reservedPaths(storage);
  for (let slot = 0; slot < LEASE_COUNT; slot += 1) {
    const path = pathname(slot);
    if (used.has(path)) continue;
    const createdAt = now();
    try {
      await storage.put(path, JSON.stringify({ createdAt, reservedMs: LEASE_MS }), {
        contentType: 'application/json', allowOverwrite: false,
      });
      used.add(path);
      return { deadline: createdAt + LEASE_MS, remainingSeconds: remaining(used) * LEASE_MS / 1000 };
    } catch (error) {
      if (error.status !== 409) throw error;
      used.add(path);
    }
  }
  return null;
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

const createVoicePilotHandler = ({ settings, storage, now = Date.now, connect = negotiate, disconnect = hangUp }) =>
  async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const config = settings();
    if (!config) return response.status(404).json({ error: 'El piloto privado no está disponible.' });
    if (!isAllowedOrigin(request) || !verifyCode(request.headers?.['x-ai-theatre-pilot'], config.code)) {
      return response.status(403).json({ error: 'El código de acceso no es válido.' });
    }
    if (request.method === 'GET') {
      try {
        const count = remaining(await reservedPaths(storage));
        return response.status(200).json({ remainingSeconds: count * LEASE_MS / 1000, attemptSeconds: LEASE_MS / 1000 });
      } catch {
        return response.status(503).json({ error: 'No se pudo comprobar el tiempo disponible.' });
      }
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      return response.status(405).json({ error: 'Método no permitido.' });
    }
    const offer = parseJsonBody(request)?.sdp;
    if (typeof offer !== 'string' || offer.length > 14_000 || !offer.startsWith('v=0') ||
        !/^m=audio /m.test(offer) || !/^m=application /m.test(offer)) {
      return response.status(400).json({ error: 'La conexión de audio no es válida.' });
    }
    let lease, call;
    try {
      lease = await reserve(storage, now);
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
  storage: sharedStorage.selectStorage({}),
});

module.exports = handler;
module.exports.createVoicePilotHandler = createVoicePilotHandler;
