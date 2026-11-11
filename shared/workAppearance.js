const validColor = (value) => Array.isArray(value) && value.length === 3 &&
  value.every((channel) => typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 255);

const normalizeBackgroundMetadata = (value) => {
  if (!value || typeof value.name !== 'string' || !value.name.trim() || !validColor(value.average) ||
      (value.accent !== undefined && !validColor(value.accent))) return null;
  return { name: value.name.trim().slice(0, 200), average: [...value.average],
    ...(value.accent ? { accent: [...value.accent] } : {}) };
};

const isSharedBackgroundUri = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      /^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(url.hostname);
  } catch { return false; }
};

const normalizeSharedAppearance = (value) => {
  const metadata = normalizeBackgroundMetadata(value?.background);
  const background = metadata && isSharedBackgroundUri(value.background.uri)
    ? { uri: value.background.uri, ...metadata } : null;
  return { revision: Number.isSafeInteger(value?.revision) && value.revision >= 0 ? value.revision : 0,
    background, updatedAt: typeof value?.updatedAt === 'string' ? value.updatedAt : null };
};

module.exports = { normalizeBackgroundMetadata, isSharedBackgroundUri, normalizeSharedAppearance };
