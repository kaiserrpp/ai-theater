const SCENE = 'ESCENA_SISTEMA';
const SONG = 'CANCION_SISTEMA';
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const unique = (values) => [...new Set(values)];

const getAuditionLineRoles = (line) => {
  if ([SCENE, SONG].includes(line.p.trim()) || line.k === 'song') return [];
  const roles = Array.isArray(line.r) && line.r.length ? line.r : [line.p];
  return unique(roles.filter((role) => typeof role === 'string' && role.trim()).map((role) => role.trim()));
};

const validateAuditionScript = (value) => {
  if (!isObject(value) || !Array.isArray(value.guion) || !value.guion.length) {
    return 'El mini-guion debe contener al menos una réplica.';
  }
  if (value.guion.length > 3000) return 'El mini-guion es demasiado largo (máximo 3000 elementos).';
  for (let index = 0; index < value.guion.length; index += 1) {
    const line = value.guion[index];
    if (!isObject(line) || typeof line.p !== 'string' || !line.p.trim() || line.p.length > 160) {
      return `Revisa el personaje del elemento ${index + 1}.`;
    }
    if (typeof line.t !== 'string' || !line.t.trim() || line.t.length > 20000) {
      return `Revisa el texto del elemento ${index + 1}.`;
    }
    if (line.a != null && (typeof line.a !== 'string' || line.a.length > 20000)) {
      return `Revisa la acotación del elemento ${index + 1}.`;
    }
    if (line.r != null && (!Array.isArray(line.r) || line.r.some((role) => typeof role !== 'string' || !role.trim() || role.length > 160))) {
      return `Revisa los personajes del elemento ${index + 1}.`;
    }
  }
  if (!value.guion.some((line) => getAuditionLineRoles(line).length)) {
    return 'El mini-guion debe tener al menos una réplica hablada y su personaje.';
  }
  return null;
};

const normalizeAuditionScript = (value, title) => {
  const guion = value.guion.map((line) => ({
    p: line.p.trim(),
    t: line.t.trim(),
    ...(line.a?.trim() ? { a: line.a.trim() } : {}),
    ...(Array.isArray(line.r) && line.r.length ? { r: unique(line.r.map((role) => role.trim())) } : {}),
    ...(line.k === 'song' ? { k: 'song' } : {}),
    ...(typeof line.songTitle === 'string' ? { songTitle: line.songTitle.trim() } : {}),
  }));
  if (guion[0]?.p !== SCENE) guion.unshift({ p: SCENE, t: title });
  return { obra: title, personajes: unique(guion.flatMap(getAuditionLineRoles)), guion };
};

const normalizeAuditionScenes = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((scene) => {
    if (!isObject(scene) || typeof scene.id !== 'string' || !scene.id.trim() || seen.has(scene.id) ||
      typeof scene.title !== 'string' || !scene.title.trim() || validateAuditionScript(scene.scriptData)) return [];
    seen.add(scene.id);
    return [{
      id: scene.id,
      title: scene.title.trim(),
      fileName: typeof scene.fileName === 'string' ? scene.fileName : null,
      revision: Number.isInteger(scene.revision) && scene.revision > 0 ? scene.revision : 1,
      scriptData: normalizeAuditionScript(scene.scriptData, scene.title.trim()),
      createdAt: typeof scene.createdAt === 'string' ? scene.createdAt : scene.updatedAt || new Date().toISOString(),
      updatedAt: typeof scene.updatedAt === 'string' ? scene.updatedAt : new Date().toISOString(),
    }];
  });
};

const resolveAuditionPreferences = (scene, saved) => {
  const checkpoint = saved?.mineCheckpoint;
  const sceneTitles = new Set(scene.scriptData.guion.filter((line) => line.p === SCENE).map((line) => line.t));
  const validCheckpoint = saved?.revision === scene.revision && isObject(checkpoint) &&
    Number.isInteger(checkpoint.lineIndex) && checkpoint.lineIndex >= 0 &&
    Array.isArray(checkpoint.roles) && checkpoint.roles.length > 0 &&
    checkpoint.roles.every((role) => scene.scriptData.personajes.includes(role)) &&
    Array.isArray(checkpoint.sceneFilter) && checkpoint.sceneFilter.length > 0 &&
    checkpoint.sceneFilter.every((title) => sceneTitles.has(title));
  return {
    roles: Array.isArray(saved?.roles) ? unique(saved.roles.filter((role) => scene.scriptData.personajes.includes(role))) : [],
    lineIndex: saved?.revision === scene.revision && Number.isInteger(saved?.lineIndex)
      ? Math.max(0, Math.min(saved.lineIndex, scene.scriptData.guion.length)) : 0,
    revision: scene.revision,
    ...(validCheckpoint ? { mineCheckpoint: {
      roles: unique(checkpoint.roles), sceneFilter: [...checkpoint.sceneFilter],
      lineIndex: Math.min(checkpoint.lineIndex, scene.scriptData.guion.length),
    } } : {}),
  };
};

module.exports = { getAuditionLineRoles, validateAuditionScript, normalizeAuditionScript, normalizeAuditionScenes, resolveAuditionPreferences };
