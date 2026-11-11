import type { BackgroundPreference, RGB } from '../src/utils/appearance';
export type SharedWorkAppearance = { revision: number; background: BackgroundPreference | null; updatedAt: string | null };
export function normalizeBackgroundMetadata(value: unknown): { name: string; average: RGB; accent?: RGB } | null;
export function isSharedBackgroundUri(value: unknown): boolean;
export function normalizeSharedAppearance(value: unknown): SharedWorkAppearance;
