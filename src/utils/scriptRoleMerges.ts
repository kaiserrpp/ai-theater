import { Dialogue, ScriptData, SCENE_SYSTEM_SPEAKER, SONG_SYSTEM_SPEAKER } from '../types/script';
import { getLineRoles } from './scriptScenes';

export type CharacterMergeMap = Record<string, string>;

const isSystemSpeaker = (speaker: string) =>
  speaker === SCENE_SYSTEM_SPEAKER || speaker === SONG_SYSTEM_SPEAKER;

export const resolveCharacterAlias = (speaker: string, mergeMap: CharacterMergeMap) => {
  let currentSpeaker = speaker;
  const visited = new Set<string>();

  while (mergeMap[currentSpeaker] && !visited.has(currentSpeaker)) {
    visited.add(currentSpeaker);
    currentSpeaker = mergeMap[currentSpeaker];
  }

  return currentSpeaker;
};

export const normalizeRoleSelection = (roles: string[], mergeMap: CharacterMergeMap) =>
  Array.from(new Set(roles.map((role) => resolveCharacterAlias(role, mergeMap))));

const mergeLineRoles = (line: Dialogue, mergeMap: CharacterMergeMap) => {
  const lineRoles = getLineRoles(line);
  if (lineRoles.length === 0) {
    return [];
  }

  return normalizeRoleSelection(lineRoles, mergeMap);
};

export const applyCharacterMerges = (scriptData: ScriptData, mergeMap: CharacterMergeMap): ScriptData => {
  const mergedCharacters = Array.from(
    new Set(scriptData.personajes.map((character) => resolveCharacterAlias(character, mergeMap)))
  ).sort();

  const mergedScript = scriptData.guion.map<Dialogue>((line) => {
    if (isSystemSpeaker(line.p)) {
      return line;
    }

    const mergedRoles = mergeLineRoles(line, mergeMap);
    const mergedSpeaker =
      mergedRoles.length > 0 ? mergedRoles.join(' / ') : resolveCharacterAlias(line.p, mergeMap);
    const shouldPersistRoles = Array.isArray(line.r) || mergedRoles.length > 1;
    const nextRoles = shouldPersistRoles ? mergedRoles : undefined;

    const hasSameSpeaker = mergedSpeaker === line.p;
    const hasSameRoles =
      (Array.isArray(line.r) ? line.r : []).join('|') === (nextRoles ?? []).join('|');

    if (hasSameSpeaker && hasSameRoles) {
      return line;
    }

    return {
      ...line,
      p: mergedSpeaker,
      ...(nextRoles ? { r: nextRoles } : {}),
    };
  });

  return {
    ...scriptData,
    personajes: mergedCharacters,
    guion: mergedScript,
  };
};

export const setCharacterMerge = (
  mergeMap: CharacterMergeMap,
  sourceCharacter: string,
  targetCharacter: string
) => {
  if (!sourceCharacter || !targetCharacter || sourceCharacter === targetCharacter) {
    return mergeMap;
  }

  const nextMergeMap: CharacterMergeMap = {
    ...mergeMap,
    [sourceCharacter]: resolveCharacterAlias(targetCharacter, mergeMap),
  };

  for (const [speaker, target] of Object.entries(nextMergeMap)) {
    const resolvedTarget = resolveCharacterAlias(target, nextMergeMap);
    if (speaker === resolvedTarget) {
      delete nextMergeMap[speaker];
    } else {
      nextMergeMap[speaker] = resolvedTarget;
    }
  }

  return nextMergeMap;
};

export const removeCharacterMerge = (mergeMap: CharacterMergeMap, sourceCharacter: string) => {
  const { [sourceCharacter]: _removed, ...rest } = mergeMap;
  return rest;
};
