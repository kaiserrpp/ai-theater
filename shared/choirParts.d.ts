export type ChoirPart =
  | 'bass' | 'bass-1' | 'bass-2'
  | 'mezzo' | 'mezzo-1' | 'mezzo-2'
  | 'soprano' | 'soprano-1' | 'soprano-2'
  | 'all';

export const CHOIR_PART_LABELS: Readonly<Record<ChoirPart, string>>;
export const CHOIR_PARTS: readonly ChoirPart[];
export function normalizeChoirPart(value: unknown): ChoirPart | null;
