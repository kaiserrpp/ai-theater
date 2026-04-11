import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SCRIPT_LIBRARY_STORAGE_KEY, SCRIPT_ROLE_MERGES_STORAGE_PREFIX } from '../store/storageKeys';
import { SavedScriptConfig, ScriptData } from '../types/script';
import { getScriptIdentity } from '../utils/scriptIdentity';

export interface SavedScript {
  id: string;
  scriptId: string;
  fileName: string;
  data: ScriptData;
  date: string;
  config: SavedScriptConfig;
}

const STORAGE_KEY = SCRIPT_LIBRARY_STORAGE_KEY;
const DEFAULT_CONFIG: SavedScriptConfig = {
  myRoles: [],
  selectedScenes: [],
  lastRehearsalMode: null,
  rehearsalCheckpoint: null,
};

const sortScripts = (scripts: SavedScript[]) =>
  [...scripts].sort((left, right) => right.date.localeCompare(left.date));

const isValidScriptData = (value: unknown): value is ScriptData => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ScriptData>;
  return (
    typeof candidate.obra === 'string' &&
    Array.isArray(candidate.personajes) &&
    Array.isArray(candidate.guion)
  );
};

const normalizeSavedScript = (value: unknown): SavedScript | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<SavedScript>;
  if (!isValidScriptData(candidate.data)) {
    return null;
  }

  const scriptId = candidate.scriptId ?? getScriptIdentity(candidate.data);
  return {
    id: candidate.id ?? scriptId,
    scriptId,
    fileName: candidate.fileName ?? candidate.data.obra,
    data: candidate.data,
    date:
      typeof candidate.date === 'string' && candidate.date
        ? candidate.date
        : new Date().toISOString(),
    config: {
      ...DEFAULT_CONFIG,
      ...(candidate.config ?? {}),
    },
  };
};

export const useLibrary = () => {
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([]);
  const savedScriptsRef = useRef<SavedScript[]>([]);

  useEffect(() => {
    savedScriptsRef.current = savedScripts;
  }, [savedScripts]);

  const loadLibrary = useCallback(async () => {
    try {
      const jsonValue = await AsyncStorage.getItem(STORAGE_KEY);
      if (jsonValue != null) {
        const parsedScripts = JSON.parse(jsonValue) as unknown[];
        setSavedScripts(
          sortScripts(parsedScripts.map(normalizeSavedScript).filter((script): script is SavedScript => Boolean(script)))
        );
        return;
      }

      setSavedScripts([]);
    } catch (error) {
      console.error('Error cargando biblioteca', error);
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const persistScripts = useCallback(async (nextScripts: SavedScript[]) => {
    const sortedScripts = sortScripts(nextScripts);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sortedScripts));
    setSavedScripts(sortedScripts);
  }, []);

  const saveScript = useCallback(
    async (fileName: string, data: ScriptData, config?: Partial<SavedScriptConfig>) => {
      try {
        const scriptId = getScriptIdentity(data);
        const existingScript = savedScriptsRef.current.find((script) => script.scriptId === scriptId);
        const newScript: SavedScript = {
          id: existingScript?.id ?? scriptId,
          scriptId,
          fileName,
          data,
          date: new Date().toISOString(),
          config: {
            ...DEFAULT_CONFIG,
            ...(existingScript?.config ?? {}),
            ...(config ?? {}),
          },
        };

        const filteredScripts = savedScriptsRef.current.filter((script) => script.scriptId !== scriptId);
        await persistScripts([newScript, ...filteredScripts]);
      } catch (error) {
        console.error('Error guardando', error);
      }
    },
    [persistScripts]
  );

  const saveScriptConfig = useCallback(
    async (data: ScriptData, config: Partial<SavedScriptConfig>) => {
      try {
        const scriptId = getScriptIdentity(data);
        const existingScript = savedScriptsRef.current.find((script) => script.scriptId === scriptId);
        const nextScript: SavedScript = {
          id: existingScript?.id ?? scriptId,
          scriptId,
          fileName: existingScript?.fileName ?? data.obra,
          data: existingScript?.data ?? data,
          date: new Date().toISOString(),
          config: {
            ...DEFAULT_CONFIG,
            ...(existingScript?.config ?? {}),
            ...config,
          },
        };

        const filteredScripts = savedScriptsRef.current.filter((script) => script.scriptId !== scriptId);
        await persistScripts([nextScript, ...filteredScripts]);
      } catch (error) {
        console.error('Error guardando configuracion', error);
      }
    },
    [persistScripts]
  );

  const deleteScript = useCallback(
    async (id: string) => {
      try {
        const deletedScript = savedScriptsRef.current.find((script) => script.id === id);
        const updatedScripts = savedScriptsRef.current.filter((script) => script.id !== id);
        await persistScripts(updatedScripts);
        if (deletedScript) {
          await AsyncStorage.removeItem(`${SCRIPT_ROLE_MERGES_STORAGE_PREFIX}${deletedScript.scriptId}`);
        }
      } catch (error) {
        console.error('Error borrando', error);
      }
    },
    [persistScripts]
  );

  return { savedScripts, saveScript, saveScriptConfig, deleteScript, reloadLibrary: loadLibrary };
};
