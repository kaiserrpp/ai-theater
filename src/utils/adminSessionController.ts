export type AdminSessionReply = { authenticated: boolean; remembered?: boolean; expiresAt?: number };
export type AdminSessionSnapshot = {
  status: 'checking' | 'authenticated' | 'signed-out' | 'unavailable';
  remembered: boolean; expiresAt: number | null; error: string | null;
};
export type AdminSessionTransport = (method: 'GET' | 'POST' | 'DELETE', body?: { password: string; remember: boolean }) => Promise<AdminSessionReply>;

export const createAdminSessionController = (request: AdminSessionTransport) => {
  let state: AdminSessionSnapshot = { status: 'checking', remembered: false, expiresAt: null, error: null };
  const listeners = new Set<() => void>();
  let epoch = 0, mutating = false;
  let pendingRestore: Promise<void> | null = null;
  const set = (next: AdminSessionSnapshot) => { state = next; listeners.forEach((listener) => listener()); };
  const fromReply = (reply: AdminSessionReply): AdminSessionSnapshot => reply.authenticated && typeof reply.expiresAt === 'number' && reply.expiresAt > Date.now()
    ? { status: 'authenticated', remembered: reply.remembered === true, expiresAt: reply.expiresAt, error: null }
    : { status: 'signed-out', remembered: false, expiresAt: null, error: null };
  const restore = (): Promise<void> => {
    if (mutating) return Promise.resolve();
    if (pendingRestore) return pendingRestore;
    const current = epoch;
    if (state.status !== 'authenticated') set({ ...state, status: 'checking', error: null });
    pendingRestore = request('GET').then((reply) => {
      if (current === epoch) set(fromReply(reply));
    }).catch(() => {
      if (current === epoch) set({ ...state, status: state.status === 'authenticated' && (state.expiresAt ?? 0) > Date.now() ? 'authenticated' : 'unavailable',
        error: 'No se pudo comprobar el acceso. Reintenta cuando tengas conexión.' });
    }).finally(() => { pendingRestore = null; });
    return pendingRestore;
  };
  const signIn = async (password: string, remember = true) => {
    const current = ++epoch; mutating = true;
    try {
      await request('POST', { password, remember });
      // Confirm the browser actually accepted the HttpOnly cookie before opening management.
      const next = fromReply(await request('GET'));
      if (next.status !== 'authenticated') throw new Error('El navegador no ha conservado la sesión. Permite las cookies de esta app y vuelve a intentarlo.');
      if (current === epoch) set(next);
    } catch (failure) {
      if (current === epoch) set({ status: 'signed-out', remembered: false, expiresAt: null, error: failure instanceof Error ? failure.message : 'No se pudo validar la clave.' });
      throw failure;
    } finally { if (current === epoch) mutating = false; }
  };
  const signOut = async () => {
    const current = ++epoch; mutating = true;
    try {
      await request('DELETE');
      if (current === epoch) set({ status: 'signed-out', remembered: false, expiresAt: null, error: null });
    } finally { if (current === epoch) mutating = false; }
  };
  const invalidate = () => {
    epoch++; mutating = false;
    set({ status: 'signed-out', remembered: false, expiresAt: null, error: 'El acceso de administración ha caducado. Introduce la clave para continuar.' });
  };
  return { getSnapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, restore, signIn, signOut, invalidate };
};
