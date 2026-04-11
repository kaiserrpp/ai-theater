import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SCRIPT_ROLE_MERGES_STORAGE_PREFIX } from '../store/storageKeys';
import { ScriptData } from '../types/script';
import { getScriptIdentity } from '../utils/scriptIdentity';
import {
  applyCharacterMerges,
  CharacterMergeMap,
  removeCharacterMerge,
  resolveCharacterAlias,
  setCharacterMerge,
} from '../utils/scriptRoleMerges';

const buildStorageKey = (scriptId: string) => `${SCRIPT_ROLE_MERGES_STORAGE_PREFIX}${scriptId}`;

export const useScriptRoleMerges = (scriptData: ScriptData | null) => {
  const scriptId = useMemo(() => (scriptData ? getScriptIdentity(scriptData) : ''), [scriptData]);
  const [mergeMap, setMergeMap] = useState<CharacterMergeMap>({});
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    const loadMergeMap = async () => {
      if (!scriptData || !scriptId) {
        setMergeMap({});
        setIsReady(true);
        return;
      }

      setIsReady(false);

      try {
        const storedValue = await AsyncStorage.getItem(buildStorageKey(scriptId));
        if (isCancelled) {
          return;
        }

        setMergeMap(storedValue ? (JSON.parse(storedValue) as CharacterMergeMap) : {});
      } catch (error) {
        console.warn('No se pudieron cargar las fusiones guardadas.', error);
        if (!isCancelled) {
          setMergeMap({});
        }
      } finally {
        if (!isCancelled) {
          setIsReady(true);
        }
      }
    };

    void loadMergeMap();

    return () => {
      isCancelled = true;
    };
  }, [scriptData, scriptId]);

  useEffect(() => {
    if (!scriptId || !isReady) {
      return;
    }

    void AsyncStorage.setItem(buildStorageKey(scriptId), JSON.stringify(mergeMap));
  }, [isReady, mergeMap, scriptId]);

  const mergedScriptData = useMemo(
    () => (scriptData ? applyCharacterMerges(scriptData, mergeMap) : null),
    [mergeMap, scriptData]
  );

  const mergeEntries = useMemo(
    () =>
      Object.entries(mergeMap)
        .map(([sourceCharacter, targetCharacter]) => ({
          sourceCharacter,
          targetCharacter: resolveCharacterAlias(targetCharacter, mergeMap),
        }))
        .sort((left, right) => left.sourceCharacter.localeCompare(right.sourceCharacter)),
    [mergeMap]
  );

  const mergeSourceCandidates = useMemo(() => {
    if (!scriptData) {
      return [];
    }

    return scriptData.personajes
      .filter((character) => !mergeMap[character])
      .sort((left, right) => left.localeCompare(right));
  }, [mergeMap, scriptData]);

  const mergeCharacter = useCallback((sourceCharacter: string, targetCharacter: string) => {
    setMergeMap((currentMergeMap) => setCharacterMerge(currentMergeMap, sourceCharacter, targetCharacter));
  }, []);

  const removeMerge = useCallback((sourceCharacter: string) => {
    setMergeMap((currentMergeMap) => removeCharacterMerge(currentMergeMap, sourceCharacter));
  }, []);

  const clearMerges = useCallback(() => {
    setMergeMap({});
  }, []);

  return {
    isReady,
    mergeMap,
    mergeEntries,
    mergeSourceCandidates,
    mergedScriptData,
    mergeCharacter,
    removeMerge,
    clearMerges,
  };
};
