const { createHash, createHmac, randomBytes, timingSafeEqual } = require('node:crypto');

const REMEMBER_SECONDS = 90 * 24 * 60 * 60;
const SESSION_SECONDS = 8 * 60 * 60;
const nowSeconds = () => Math.floor(Date.now() / 1000);
const hash = (value) => createHash('sha256').update(value).digest();
const hasAdminPassword = () => typeof process.env.SONG_ADMIN_PASSWORD === 'string' && process.env.SONG_ADMIN_PASSWORD.length > 0;
const isValidAdminPassword = (password) => hasAdminPassword() && typeof password === 'string' && password.length <= 1024
  && timingSafeEqual(hash(password), hash(process.env.SONG_ADMIN_PASSWORD));
const signingKey = () => {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.BLOB_READ_WRITE_TOKEN;
  if (!hasAdminPassword() || !secret) return null;
  // The random server secret prevents offline guessing of the management password from a cookie.
  return createHmac('sha256', secret).update(`ai-theatre-admin-session-v1\0${process.env.SONG_ADMIN_PASSWORD}`).digest();
};
const host = (request) => typeof request.headers?.host === 'string' ? request.headers.host.toLowerCase() : '';
const isSecure = (request) => ['production', 'preview'].includes(process.env.VERCEL_ENV)
  || request.headers?.['x-forwarded-proto'] === 'https' || Boolean(request.socket?.encrypted);
const cookieName = (request) => isSecure(request) ? '__Host-ai_theatre_admin' : 'ai_theatre_admin_dev';

const isAllowedOrigin = (request) => {
  const origin = request.headers?.origin;
  const site = request.headers?.['sec-fetch-site'];
  if (site && !['same-origin', 'none'].includes(site)) return false;
  if (origin === undefined) return true; // Non-browser clients may omit Origin.
  if (typeof origin !== 'string' || !host(request)) return false;
  try { return new URL(origin).origin === `${isSecure(request) ? 'https' : 'http'}://${host(request)}`; }
  catch { return false; }
};
const readCookie = (request) => {
  const header = request.headers?.cookie;
  if (typeof header !== 'string' || header.length > 16384) return null;
  const matches = header.split(';').map((entry) => entry.trim()).filter((entry) => entry.startsWith(`${cookieName(request)}=`));
  return matches.length === 1 ? matches[0].slice(cookieName(request).length + 1) : null;
};
const readAdminSession = (request, namespace) => {
  const value = readCookie(request), key = signingKey();
  if (!value || !key || !host(request) || !isAllowedOrigin(request) || value.length > 2048) return null;
  const parts = value.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[1])) return null;
  const expected = createHmac('sha256', key).update(parts[0]).digest();
  const supplied = Buffer.from(parts[1], 'base64url');
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const session = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const now = nowSeconds();
    const lifetime = session.remember === true ? REMEMBER_SECONDS : SESSION_SECONDS;
    if (session.v !== 1 || session.scope !== 'admin' || session.host !== host(request) || session.namespace !== namespace
      || typeof session.remember !== 'boolean' || !Number.isInteger(session.iat) || !Number.isInteger(session.exp)
      || session.iat > now + 30 || session.exp <= now || session.exp <= session.iat || session.exp - session.iat > lifetime) return null;
    return session;
  } catch { return null; }
};
const cookieAttributes = (request) => `Path=/; HttpOnly; SameSite=Strict${isSecure(request) ? '; Secure' : ''}`;
const clearAdminSession = (request, response) => response.setHeader('Set-Cookie', `${cookieName(request)}=; ${cookieAttributes(request)}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
const issueAdminSession = (request, response, namespace, remember) => {
  const key = signingKey();
  if (!key || !host(request)) throw new Error('No se pudo preparar la sesión de administración.');
  const now = nowSeconds(), seconds = remember ? REMEMBER_SECONDS : SESSION_SECONDS;
  const session = { v: 1, scope: 'admin', host: host(request), namespace, remember, iat: now, exp: now + seconds, nonce: randomBytes(16).toString('base64url') };
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const value = `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`;
  const persistence = remember ? `; Max-Age=${seconds}; Expires=${new Date(session.exp * 1000).toUTCString()}` : '';
  response.setHeader('Set-Cookie', `${cookieName(request)}=${value}; ${cookieAttributes(request)}${persistence}`);
  return session;
};
const isAuthorizedAdminRequest = (request, password, namespace) => {
  if (!isAllowedOrigin(request)) return false;
  if (isValidAdminPassword(password)) return true; // Compatibility with previously published clients.
  if (!readAdminSession(request, namespace)) return false;
  if (['GET', 'HEAD'].includes(request.method)) return true;
  // A cross-origin form cannot send this header, and cross-origin fetches fail preflight.
  return request.headers?.['x-ai-theatre-admin'] === '1';
};

module.exports = { REMEMBER_SECONDS, SESSION_SECONDS, hasAdminPassword, isValidAdminPassword, isAllowedOrigin,
  readAdminSession, issueAdminSession, clearAdminSession, isAuthorizedAdminRequest };
