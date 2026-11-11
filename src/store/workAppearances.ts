import type { PreferredWork } from '../utils/preferredWork';
import { parseBackgroundPreference, type BackgroundPreference } from '../utils/appearance';
import { BACKGROUND_STORAGE_KEY, WORK_APPEARANCES_STORAGE_KEY } from './storageKeys';

export type WorkAppearances = Record<string, BackgroundPreference | null>;
type Storage = { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<unknown>; removeItem: (key: string) => Promise<unknown> };
export const appearanceWorkKey = (work: PreferredWork | null) => work ? `${work.kind}:${work.id}` : null;

export const resolveWorkBackground = (works: WorkAppearances, workKey: string | null, localWorkKey: string | null = null) => {
  if (!workKey) return null;
  if (Object.prototype.hasOwnProperty.call(works, workKey)) return works[workKey];
  // Publishing a local work keeps the poster selected before it had a share ID.
  return workKey.startsWith('shared:') && localWorkKey?.startsWith('local:') ? works[localWorkKey] ?? null : null;
};

const parseAppearances = (stored: string | null): WorkAppearances => {
  if (!stored) return {};
  const parsed = JSON.parse(stored);
  if (parsed?.version !== 1 || !parsed.works || typeof parsed.works !== 'object' || Array.isArray(parsed.works)) throw new Error('No se pudo leer la apariencia de tus obras.');
  const works: WorkAppearances = {};
  for (const [key, value] of Object.entries(parsed.works)) {
    if (!/^(shared|local):.+/.test(key)) continue;
    const preference = parseBackgroundPreference(JSON.stringify(value));
    if (value === null || preference) works[key] = preference;
  }
  return works;
};
const serialize = (works: WorkAppearances) => JSON.stringify({ version: 1, works });

export const createWorkAppearanceStore = (storage: Storage, legacyOwnerKey: string) => {
  let works: WorkAppearances = {};
  let loading: Promise<WorkAppearances> | undefined;
  let queue = Promise.resolve();
  const load = async () => {
    loading ??= (async () => {
      const [stored, legacy] = await Promise.all([storage.getItem(WORK_APPEARANCES_STORAGE_KEY), storage.getItem(BACKGROUND_STORAGE_KEY)]);
      works = parseAppearances(stored);
      const previousBackground = parseBackgroundPreference(legacy);
      if (previousBackground && !Object.prototype.hasOwnProperty.call(works, legacyOwnerKey)) {
        const migrated = { ...works, [legacyOwnerKey]: previousBackground };
        await storage.setItem(WORK_APPEARANCES_STORAGE_KEY, serialize(migrated));
        works = migrated;
      }
      // Only retire the old setting after its destination is safely persisted.
      if (legacy) await storage.removeItem(BACKGROUND_STORAGE_KEY).catch(() => {});
      return works;
    })().catch((error) => { loading = undefined; throw error; });
    await loading;
    return works;
  };
  const save = (workKey: string, background: BackgroundPreference | null) => {
    const operation = queue.then(async () => {
      await load();
      const previous = works[workKey];
      const next = { ...works, [workKey]: background };
      await storage.setItem(WORK_APPEARANCES_STORAGE_KEY, serialize(next));
      works = next;
      const orphanedUri = previous && !Object.values(next).some((value) => value?.uri === previous.uri) ? previous.uri : null;
      return { works: next, orphanedUri };
    });
    queue = operation.then(() => {}, () => {});
    return operation;
  };
  return { load, save };
};
