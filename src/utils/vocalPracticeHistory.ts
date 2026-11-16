export const VOCAL_PRACTICE_KEY = '@teatro_ia_vocal_practice_v1';
export const WARMUP_INTERVAL_MS = 2 * 60 * 60 * 1000;
export type VocalPracticeHistory = { enabled: boolean; lastActivityAt: number | null };
export const parseVocalPracticeHistory = (stored: string | null): VocalPracticeHistory => {
  try {
    const value = JSON.parse(stored || 'null');
    return { enabled: value?.enabled !== false,
      lastActivityAt: typeof value?.lastActivityAt === 'number' && Number.isFinite(value.lastActivityAt) && value.lastActivityAt > 0 ? value.lastActivityAt : null };
  } catch { return { enabled: true, lastActivityAt: null }; }
};
export const shouldWarmUpBeforeSinging = (history: VocalPracticeHistory, now: number) => history.enabled &&
  (history.lastActivityAt === null || history.lastActivityAt > now || now - history.lastActivityAt > WARMUP_INTERVAL_MS);

export const createVocalPracticeHistory = (storage: { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<unknown> }, now = Date.now) => {
  let state = { ...parseVocalPracticeHistory(null), loaded: false, error: '' };
  let loading: Promise<void> | null = null, writes = Promise.resolve();
  let changedEnabled = false, changedActivity = false;
  const listeners = new Set<() => void>();
  const update = (next: typeof state) => { state = next; listeners.forEach(listener => listener()); };
  const persist = () => {
    writes = writes.catch(() => {}).then(async () => {
      await load();
      await storage.setItem(VOCAL_PRACTICE_KEY, JSON.stringify({ enabled: state.enabled, lastActivityAt: state.lastActivityAt }));
    }).catch(() => update({ ...state, error: 'No se pudo recordar la actividad de canto en este dispositivo.' }));
  };
  const load = () => loading ??= storage.getItem(VOCAL_PRACTICE_KEY).then(stored => {
    const saved = parseVocalPracticeHistory(stored);
    update({ ...state, enabled: changedEnabled ? state.enabled : saved.enabled,
      lastActivityAt: changedActivity ? state.lastActivityAt : saved.lastActivityAt, loaded: true });
  }).catch(() => update({ ...state, loaded: true, error: 'No se pudo recuperar la última actividad de canto.' }));
  return {
    load, getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setEnabled: (enabled: boolean) => { changedEnabled = true; update({ ...state, enabled }); persist(); },
    recordActivity: (force = false) => {
      const time = now();
      if (!force && state.lastActivityAt !== null && time >= state.lastActivityAt && time - state.lastActivityAt < 30000) return;
      changedActivity = true; update({ ...state, lastActivityAt: time }); persist();
    },
    due: () => shouldWarmUpBeforeSinging(state, now()),
    flush: () => writes,
  };
};
