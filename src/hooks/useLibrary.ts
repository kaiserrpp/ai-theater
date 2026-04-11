import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { SCRIPT_LIBRARY_STORAGE_KEY } from '../store/storageKeys';
import { ScriptData } from '../types/script';

export interface SavedScript {
  id: string;
  fileName: string;
  data: ScriptData;
  date: string;
}

const STORAGE_KEY = SCRIPT_LIBRARY_STORAGE_KEY;

export const useLibrary = () => {
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([]);

  useEffect(() => {
    const loadLibrary = async () => {
      try {
        const jsonValue = await AsyncStorage.getItem(STORAGE_KEY);
        if (jsonValue != null) {
          setSavedScripts(JSON.parse(jsonValue));
        }
      } catch (error) {
        console.error('Error cargando biblioteca', error);
      }
    };

    void loadLibrary();
  }, []);

  const saveScript = async (fileName: string, data: ScriptData) => {
    try {
      const newScript: SavedScript = {
        id: Date.now().toString(),
        fileName,
        data,
        date: new Date().toLocaleDateString(),
      };

      const filteredScripts = savedScripts.filter((script) => script.fileName !== fileName);
      const updatedScripts = [newScript, ...filteredScripts];

      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedScripts));
      setSavedScripts(updatedScripts);
    } catch (error) {
      console.error('Error guardando', error);
    }
  };

  const deleteScript = async (id: string) => {
    try {
      const updatedScripts = savedScripts.filter((script) => script.id !== id);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedScripts));
      setSavedScripts(updatedScripts);
    } catch (error) {
      console.error('Error borrando', error);
    }
  };

  return { savedScripts, saveScript, deleteScript };
};
