import { isSharedBackgroundUri, normalizeSharedAppearance, type SharedWorkAppearance } from '../../shared/workAppearance';
import type { BackgroundPreference } from './appearance';

type Dependencies = {
  initial?: SharedWorkAppearance;
  read: () => Promise<SharedWorkAppearance>;
  write: (background: BackgroundPreference | null, revision: number) => Promise<SharedWorkAppearance>;
};

// One session belongs to one shared work. Late requests for a previous work
// cannot replace the current work's image, and reads cannot undo a newer save.
export const createSharedAppearanceSession = ({ initial, read, write }: Dependencies) => {
  let snapshot = { appearance: normalizeSharedAppearance(initial), notice: '' };
  const listeners = new Set<() => void>();
  let pendingRead: Promise<void> | null = null;
  let queue = Promise.resolve();
  let mutation = 0;
  let migrationAttempted = false;
  let canMigrateRequested = false;
  let migrationCandidate: BackgroundPreference | null = null;
  const update = (appearance: SharedWorkAppearance, notice = '') => {
    if (appearance.revision < snapshot.appearance.revision) return;
    snapshot = { appearance, notice };
    listeners.forEach((listener) => listener());
  };
  const save = (background: BackgroundPreference | null, migrating = false) => {
    mutation += 1;
    const operation = queue.then(async () => {
      try {
        const saved = await write(background, migrating ? 0 : snapshot.appearance.revision);
        update(saved);
        return saved;
      } catch (error) {
        if ((error as { status?: number }).status === 409) {
          update(await read());
          if (migrating) return snapshot.appearance;
        }
        update(snapshot.appearance, error instanceof Error ? error.message : 'No se pudo compartir el fondo.');
        throw error;
      }
    });
    queue = operation.then(() => {}, () => {});
    return operation;
  };
  const refresh = (canMigrate = false, legacy: BackgroundPreference | null = null) => {
    if (canMigrate && !canMigrateRequested) migrationAttempted = false;
    canMigrateRequested = canMigrate;
    migrationCandidate = legacy;
    if (pendingRead) return pendingRead;
    const startedAt = mutation;
    pendingRead = (async () => {
      try {
        const remote = await read();
        if (startedAt !== mutation) return;
        update(remote, remote.revision === 0 && migrationAttempted ? snapshot.notice : '');
        if (canMigrateRequested && migrationCandidate && !isSharedBackgroundUri(migrationCandidate.uri) &&
            snapshot.appearance.revision === 0 && !migrationAttempted) {
          migrationAttempted = true;
          await save(migrationCandidate, true);
        }
      } catch (error) {
        if (startedAt === mutation || migrationAttempted) update(snapshot.appearance,
          error instanceof Error ? error.message : 'No se pudo recuperar el fondo compartido.');
      }
    })().finally(() => { pendingRead = null; });
    return pendingRead;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    save: (background: BackgroundPreference | null) => save(background), refresh,
    retry: (canMigrate: boolean, legacy: BackgroundPreference | null) => {
      migrationAttempted = false;
      return refresh(canMigrate, legacy);
    },
  };
};
