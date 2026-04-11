import { Dialogue, SCENE_SYSTEM_SPEAKER } from '../types/script';

export const isSceneMarker = (line?: Dialogue | null) => line?.p === SCENE_SYSTEM_SPEAKER;

export const getSceneTitles = (guion: Dialogue[]) =>
  guion.filter((line) => isSceneMarker(line)).map((line) => line.t);

export const getScenesForRoles = (guion: Dialogue[], myRoles: string[]) => {
  const selectedRoles = new Set(myRoles);
  const matchingScenes = new Map<string, boolean>();
  let currentScene = '';

  for (const line of guion) {
    if (isSceneMarker(line)) {
      currentScene = line.t;
      if (!matchingScenes.has(currentScene)) {
        matchingScenes.set(currentScene, false);
      }
      continue;
    }

    if (currentScene && selectedRoles.has(line.p)) {
      matchingScenes.set(currentScene, true);
    }
  }

  return Array.from(matchingScenes.entries())
    .filter(([, hasMatchingRole]) => hasMatchingRole)
    .map(([sceneTitle]) => sceneTitle);
};

export const filterScriptByScenes = (guion: Dialogue[], filterScenes: string[]) => {
  const selectedScenes = new Set(filterScenes);
  let currentScene = '';

  return guion.filter((line) => {
    if (isSceneMarker(line)) {
      currentScene = line.t;
    }

    return selectedScenes.has(currentScene);
  });
};
