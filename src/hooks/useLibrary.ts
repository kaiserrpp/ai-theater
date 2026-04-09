import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { ScriptData } from './useGemini';

export interface SavedScript {
  id: string;
  fileName: string;
  data: ScriptData;
  date: string;
}

const STORAGE_KEY = '@teatro_ia_library';

export const useLibrary = () => {
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([]);

  // Cargar biblioteca al iniciar
  useEffect(() => {
    const loadLibrary = async () => {
      try {
        const jsonValue = await AsyncStorage.getItem(STORAGE_KEY);
        if (jsonValue != null) {
          setSavedScripts(JSON.parse(jsonValue));
        }
      } catch (e) {
        console.error("Error cargando biblioteca", e);
      }
    };
    loadLibrary();
  }, []);

  // Guardar guión nuevo
  const saveScript = async (fileName: string, data: ScriptData) => {
    try {
      const newScript: SavedScript = {
        id: Date.now().toString(),
        fileName,
        data,
        date: new Date().toLocaleDateString(),
      };
      
      const filteredScripts = savedScripts.filter(s => s.fileName !== fileName);
      const updatedScripts = [newScript, ...filteredScripts];
      
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedScripts));
      setSavedScripts(updatedScripts);
    } catch (e) {
      console.error("Error guardando", e);
    }
  };

  // Borrar guión
  const deleteScript = async (id: string) => {
    try {
      const updatedScripts = savedScripts.filter(script => script.id !== id);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedScripts));
      setSavedScripts(updatedScripts);
    } catch (e) {
      console.error("Error borrando", e);
    }
  };

  return { savedScripts, saveScript, deleteScript };
};