import type { AuditionPreferences } from '../../shared/auditionScenes';
import type { SharedAuditionScene } from '../types/sharedScript';
import { areSceneSelectionsEqual, filterScriptByScenes, getSceneTitles, getScenesForRoles } from './scriptScenes';

export type AuditionRehearsalMode = 'ALL' | 'MINE';

export const getAuditionRehearsalPlan = (
  scene: SharedAuditionScene, preferences: AuditionPreferences, mode: AuditionRehearsalMode
) => {
  const sceneFilter = mode === 'ALL' ? getSceneTitles(scene.scriptData.guion)
    : getScenesForRoles(scene.scriptData.guion, preferences.roles);
  const lineCount = filterScriptByScenes(scene.scriptData.guion, sceneFilter).length;
  const checkpoint = preferences.mineCheckpoint;
  const matchesRoles = checkpoint && checkpoint.roles.length === preferences.roles.length &&
    checkpoint.roles.every((role) => preferences.roles.includes(role));
  const savedIndex = mode === 'ALL' ? preferences.lineIndex
    : checkpoint && matchesRoles && areSceneSelectionsEqual(checkpoint.sceneFilter, sceneFilter) ? checkpoint.lineIndex : 0;
  const lineIndex = Math.max(0, Math.min(savedIndex, lineCount));
  return { sceneFilter, lineCount, lineIndex, canResume: lineIndex > 0 && lineIndex < lineCount };
};

export const recordAuditionRehearsalProgress = (
  preferences: AuditionPreferences, mode: AuditionRehearsalMode, sceneFilter: string[], roles: string[], lineIndex: number
): AuditionPreferences => {
  if (mode === 'ALL') return preferences.lineIndex === lineIndex ? preferences : { ...preferences, lineIndex };
  const previous = preferences.mineCheckpoint;
  if (previous && previous.lineIndex === lineIndex && areSceneSelectionsEqual(previous.sceneFilter, sceneFilter) &&
    previous.roles.length === roles.length && previous.roles.every((role) => roles.includes(role))) return preferences;
  return { ...preferences, mineCheckpoint: { roles: [...roles], sceneFilter: [...sceneFilter], lineIndex } };
};
