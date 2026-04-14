import { Dialogue, SCENE_SYSTEM_SPEAKER, SONG_SYSTEM_SPEAKER } from '../types/script';
import { SharedSongAsset } from '../types/sharedScript';

export const isSceneMarker = (line?: Dialogue | null) => line?.p === SCENE_SYSTEM_SPEAKER;
export const isSongCue = (line?: Dialogue | null) => line?.p === SONG_SYSTEM_SPEAKER || line?.k === 'song';
export const isSystemCue = (line?: Dialogue | null) => isSceneMarker(line) || isSongCue(line);

export const getLineRoles = (line?: Dialogue | null) => {
  if (!line || isSystemCue(line)) {
    return [];
  }

  return Array.isArray(line.r) && line.r.length > 0 ? line.r : [line.p];
};

export const lineMatchesRoles = (line: Dialogue | null | undefined, roles: Iterable<string>) => {
  const selectedRoles = roles instanceof Set ? roles : new Set(roles);
  return getLineRoles(line).some((role) => selectedRoles.has(role));
};

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

    if (currentScene && lineMatchesRoles(line, selectedRoles)) {
      matchingScenes.set(currentScene, true);
    }
  }

  return Array.from(matchingScenes.entries())
    .filter(([, hasMatchingRole]) => hasMatchingRole)
    .map(([sceneTitle]) => sceneTitle);
};

const songMatchesRoles = (
  song: SharedSongAsset | null | undefined,
  selectedRoles: Set<string>
) =>
  Boolean(
    song?.audios.some((audio) => audio.guideRoles.some((role) => selectedRoles.has(role)))
  );

export const getScenesForRolesAndSongs = (
  guion: Dialogue[],
  myRoles: string[],
  sharedSongs: SharedSongAsset[] = []
) => {
  const selectedRoles = new Set(myRoles);
  const matchingScenes = new Map<string, boolean>();
  const songsByLineIndex = new Map(sharedSongs.map((song) => [song.lineIndex, song]));
  let currentScene = '';

  guion.forEach((line, lineIndex) => {
    if (isSceneMarker(line)) {
      currentScene = line.t;
      if (!matchingScenes.has(currentScene)) {
        matchingScenes.set(currentScene, false);
      }
      return;
    }

    if (!currentScene) {
      return;
    }

    if (lineMatchesRoles(line, selectedRoles)) {
      matchingScenes.set(currentScene, true);
      return;
    }

    if (isSongCue(line) && songMatchesRoles(songsByLineIndex.get(lineIndex), selectedRoles)) {
      matchingScenes.set(currentScene, true);
    }
  });

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

export const areSceneSelectionsEqual = (leftScenes: string[], rightScenes: string[]) =>
  leftScenes.length === rightScenes.length &&
  leftScenes.every((sceneTitle, index) => sceneTitle === rightScenes[index]);
