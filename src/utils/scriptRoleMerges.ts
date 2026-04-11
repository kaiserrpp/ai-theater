import { Dialogue, ScriptData, SCENE_SYSTEM_SPEAKER, SONG_SYSTEM_SPEAKER } from '../types/script';

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

export const applyCharacterMerges = (scriptData: ScriptData, mergeMap: CharacterMergeMap): ScriptData => {
  const mergedCharacters = Array.from(
    new Set(scriptData.personajes.map((character) => resolveCharacterAlias(character, mergeMap)))
  ).sort();

  const mergedScript = scriptData.guion.map<Dialogue>((line) => {
    if (isSystemSpeaker(line.p)) {
      return line;
    }

    const mergedSpeaker = resolveCharacterAlias(line.p, mergeMap);
    return mergedSpeaker === line.p ? line : { ...line, p: mergedSpeaker };
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
