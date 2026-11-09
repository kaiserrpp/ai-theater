export const buildSharedApiUrl = (path: string, searchParams?: Record<string, string | number | null | undefined>) => {
  const web = typeof window !== 'undefined' && typeof window.location?.origin === 'string';
  const base = new URL(path, web ? window.location.origin : 'https://ai-theater.vercel.app');
  if (web) new URLSearchParams(window.location.search).forEach((value, key) => {
    if (!base.searchParams.has(key)) base.searchParams.append(key, value);
  });
  if (searchParams) Object.entries(searchParams).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') base.searchParams.set(key, String(value));
  });
  return web ? `${base.pathname}${base.search}` : base.toString();
};
