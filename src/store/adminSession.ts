import { useSyncExternalStore } from 'react';
import { buildSharedApiUrl } from '../api/sharedApiUrl';
import { createAdminSessionController, type AdminSessionTransport } from '../utils/adminSessionController';

const request: AdminSessionTransport = async (method, body) => {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 12000);
  try {
    const response = await fetch(buildSharedApiUrl('/api/shared-script/song-auth'), {
      method, credentials: 'include', cache: 'no-store', signal: abort.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-AI-Theatre-Admin': '1' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'No se pudo comprobar el acceso de administración.');
    return payload;
  } finally { clearTimeout(timeout); }
};
const session = createAdminSessionController(request);
export const restoreAdminSession = session.restore;
export const authenticateAdmin = session.signIn;
export const logoutAdmin = session.signOut;
export const invalidateAdminSession = session.invalidate;
export const useAdminSession = () => useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
export const useIsAdmin = () => useAdminSession().status === 'authenticated';
