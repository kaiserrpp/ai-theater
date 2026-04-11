import { ScriptData } from '../types/script';
import { getSceneTitles } from './scriptScenes';

const hashString = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16);
};

export const getScriptIdentity = (scriptData: ScriptData) => {
  const fingerprint = JSON.stringify({
    obra: scriptData.obra,
    personajes: scriptData.personajes,
    escenas: getSceneTitles(scriptData.guion),
    lines: scriptData.guion.length,
  });

  return hashString(fingerprint);
};
