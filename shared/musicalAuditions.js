const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const normalizeRoles = (value) => {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).filter((role) => {
    if (typeof role !== 'string' || !role.trim()) return false;
    const key = role.trim().toLocaleLowerCase('es');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map((role) => role.trim());
};
const validAudioUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return false;
  try { return ['https:', 'http:'].includes(new URL(value).protocol); }
  catch { return false; }
};
const validateMusicalAudition = (value) => {
  if (!isObject(value) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160) return 'Pon un nombre al fragmento (máximo 160 caracteres).';
  if (!Array.isArray(value.roles) || !value.roles.length || value.roles.length > 50 || value.roles.some((role) => typeof role !== 'string' || !role.trim() || role.length > 160)) return 'Elige al menos un personaje para este fragmento.';
  if (value.lyrics != null && (typeof value.lyrics !== 'string' || value.lyrics.length > 50000)) return 'La letra debe tener como máximo 50.000 caracteres.';
  return null;
};
const normalizeMusicalAuditions = (value) => {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).flatMap((cut) => {
    if (!isObject(cut) || typeof cut.id !== 'string' || !cut.id.trim() || seen.has(cut.id.trim()) ||
      typeof cut.musicalNumberId !== 'string' || !cut.musicalNumberId.trim() || validateMusicalAudition(cut)) return [];
    seen.add(cut.id.trim());
    const kinds = new Set();
    const audios = (Array.isArray(cut.audios) ? cut.audios : []).flatMap((audio) => {
      if (!isObject(audio) || !['vocal_guide', 'karaoke'].includes(audio.kind) || kinds.has(audio.kind) || !validAudioUrl(audio.audioUrl)) return [];
      kinds.add(audio.kind);
      return [{ id: typeof audio.id === 'string' ? audio.id : `${cut.id}:${audio.kind}`,
        label: audio.kind === 'karaoke' ? 'Karaoke' : 'Con voz', kind: audio.kind,
        guideRoles: normalizeRoles(cut.roles), audioUrl: audio.audioUrl.trim(),
        audioFileName: typeof audio.audioFileName === 'string' ? audio.audioFileName : null,
        contentType: typeof audio.contentType === 'string' ? audio.contentType : null,
        size: typeof audio.size === 'number' && Number.isFinite(audio.size) ? audio.size : null,
        timelineCues: [], updatedAt: audio.updatedAt || cut.updatedAt || new Date().toISOString() }];
    });
    return [{ id: cut.id.trim(), musicalNumberId: cut.musicalNumberId.trim(), title: cut.title.trim(),
      roles: normalizeRoles(cut.roles), lyrics: cut.lyrics?.trim() || '', audios,
      revision: Number.isInteger(cut.revision) && cut.revision > 0 ? cut.revision : 1,
      createdAt: cut.createdAt || new Date().toISOString(), updatedAt: cut.updatedAt || new Date().toISOString() }];
  });
};
module.exports = { normalizeMusicalAuditions, normalizeRoles, validateMusicalAudition, validAudioUrl };
