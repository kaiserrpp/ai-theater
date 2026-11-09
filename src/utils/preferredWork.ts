export type PreferredWork = { kind: 'shared' | 'local'; id: string };

export const parsePreferredWork = (stored: string | null): PreferredWork | null => {
  if (!stored) return null;
  try {
    const value = JSON.parse(stored);
    return (value?.kind === 'shared' || value?.kind === 'local') && typeof value.id === 'string' && value.id.trim()
      ? { kind: value.kind, id: value.id } : null;
  } catch { return null; }
};

export const resolveStartupWork = (shareIdFromUrl: string | null, preferred: PreferredWork | null): PreferredWork | null =>
  shareIdFromUrl?.trim() ? { kind: 'shared', id: shareIdFromUrl } : preferred;
