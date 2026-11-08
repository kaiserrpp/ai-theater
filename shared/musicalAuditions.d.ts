import type { SharedMusicalAudition } from '../src/types/sharedScript';
export function normalizeMusicalAuditions(value: unknown): SharedMusicalAudition[];
export function normalizeRoles(value: unknown): string[];
export function validateMusicalAudition(value: unknown): string | null;
export function validAudioUrl(value: unknown): boolean;
