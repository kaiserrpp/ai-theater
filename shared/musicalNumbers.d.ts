import type { Dialogue } from '../src/types/script';
import type { SharedMusicalNumberAsset, SharedSongAudioAsset } from '../src/types/sharedScript';

export function normalizeNumberDetails(value: Partial<SharedMusicalNumberAsset>): Pick<SharedMusicalNumberAsset, 'roles' | 'lyrics' | 'referenceAudioId'>;
export function normalizeNumberAudioDetails(value: Partial<SharedSongAudioAsset>): Pick<SharedSongAudioAsset, 'audibleRoles' | 'timelineNeedsReview'>;
export function markTimelinesForReview<T extends SharedSongAudioAsset>(audios: T[]): T[];
export function isRangeInScene(guion: Dialogue[], sceneTitle: string | null, start: number, end: number): boolean;
