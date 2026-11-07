import type { Dialogue, ScriptData } from '../src/types/script';
import type { SharedAuditionScene } from '../src/types/sharedScript';

export interface AuditionPreferences { roles: string[]; lineIndex: number; revision: number; }
export function getAuditionLineRoles(line: Dialogue): string[];
export function validateAuditionScript(value: unknown): string | null;
export function normalizeAuditionScript(value: ScriptData, title: string): ScriptData;
export function normalizeAuditionScenes(value: unknown): SharedAuditionScene[];
export function resolveAuditionPreferences(scene: SharedAuditionScene, saved: unknown): AuditionPreferences;
