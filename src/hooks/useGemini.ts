import { GoogleGenerativeAI } from '@google/generative-ai';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export interface Dialogue { p: string; t: string; a: string; }
export interface ScriptData { obra: string; personajes: string[]; guion: Dialogue[]; }

const API_KEY = process.env.EXPO_PUBLIC_API_KEY || '';
const genAI = new GoogleGenerativeAI(API_KEY);
const STORAGE_KEY = '@pending_job';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const useGemini = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptData, setScriptData] = useState<ScriptData | null>(null);
  const [statusText, setStatusText] = useState<string>("");
  
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [chunks, setChunks] = useState<string[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState<number>(-1);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();
        if (response.ok && data.models) {
          const utiles = data.models
            .filter((m: any) => m.supportedGenerationMethods.includes('generateContent'))
            .map((m: any) => m.name.replace('models/', ''));
          setAvailableModels(utiles);
        }
      } catch (err) {}
    };
    fetchModels();
  }, []);

  // Función para guardar el progreso actual en el disco
  const saveCheckpoint = async (data: ScriptData, fileUri: string, index: number, totalChunks: string[]) => {
    try {
      const checkpoint = JSON.stringify({ data, fileUri, index, totalChunks, timestamp: Date.now() });
      await AsyncStorage.setItem(STORAGE_KEY, checkpoint);
    } catch (e) { console.error("Error guardando checkpoint", e); }
  };

  // Función para limpiar el progreso (cuando termina o el usuario cancela)
  const clearCheckpoint = async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
  };

  const uploadAndWaitForActive = async (localUri: string, mimeType: string) => {
    const fileResp = await fetch(localUri);
    const blob = await fileResp.blob();
    const uploadResp = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`, {
      method: 'POST', headers: { 'X-Goog-Upload-Protocol': 'raw', 'X-Goog-Upload-Header-Content-Type': mimeType, 'Content-Type': mimeType },
      body: blob
    });
    const uploadData = await uploadResp.json();
    const fileUri = uploadData.file.uri;
    const fileName = uploadData.file.name;

    let isReady = false;
    while (!isReady) { 
      await wait(3000);
      const checkResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${API_KEY}`);
      const checkData = await checkResp.json();
      if (checkData.state === "ACTIVE") isReady = true;
    }
    return fileUri;
  };

  const tryAllModels = async (prompt: string, fileUri: string) => {
    for (const modelName of availableModels) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: "application/json", temperature: 0.1 } });
        const result = await model.generateContent([{ text: prompt }, { fileData: { mimeType: 'application/pdf', fileUri } }]);
        return result.response.text();
      } catch (err) { await wait(2000); }
    }
    throw new Error("Fallo en modelos");
  };

  const analyzeInStages = async (localUri: string | null, resumeData?: any) => {
    setLoading(true); setError(null);
    let currentFileUri = resumeData?.fileUri || "";
    let startAt = resumeData?.index + 1 || 0;
    let sceneList = resumeData?.totalChunks || [];
    let currentScript = resumeData?.data || { obra: "Procesando...", personajes: [], guion: [] };

    try {
      // Si no es reanudación, hay que subir el archivo y crear el índice
      if (!resumeData && localUri) {
        currentFileUri = await uploadAndWaitForActive(localUri, 'application/pdf');
        setStatusText("Creando índice de escenas...");
        const indexPrompt = `Devuelve un array JSON de las escenas: ["Escena 1", ...]`;
        const indexText = await tryAllModels(indexPrompt, currentFileUri);
        sceneList = JSON.parse(indexText.substring(indexText.indexOf('['), indexText.lastIndexOf(']') + 1));
        setChunks(sceneList);
      } else {
        setChunks(sceneList);
        setScriptData(currentScript);
      }

      for (let i = startAt; i < sceneList.length; i++) {
        setCurrentChunkIndex(i);
        setStatusText(`Extrayendo: ${sceneList[i]}`);
        
        const scenePrompt = `Extrae diálogos íntegros de "${sceneList[i]}" en JSON: {"obra":"t", "personajes":["P1"], "guion":[{"p":"P", "t":"t", "a":"a"}]}`;
        try {
          const chunkText = await tryAllModels(scenePrompt, currentFileUri);
          const chunkData = JSON.parse(chunkText.substring(chunkText.indexOf('{'), chunkText.lastIndexOf('}') + 1));

          if (i === 0) currentScript.obra = chunkData.obra || currentScript.obra;
          chunkData.personajes?.forEach((p: string) => {
            if (!currentScript.personajes.includes(p.trim().toUpperCase())) {
                currentScript.personajes.push(p.trim().toUpperCase());
            }
          });
          
          const sceneMarker: Dialogue = { p: 'ESCENA_SISTEMA', t: sceneList[i], a: '' };
          currentScript.guion = [...currentScript.guion, sceneMarker, ...(chunkData.guion || [])];
          
          setScriptData({ ...currentScript });

          // CHECKPOINT: Guardamos después de cada escena exitosa
          await saveCheckpoint(currentScript, currentFileUri, i, sceneList);

        } catch (e) { console.warn("Error en escena", i); }
      }

      setStatusText("¡Obra completada!");
      await clearCheckpoint(); // Al terminar, borramos el temporal
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return { analyzeInStages, loading, error, scriptData, setScriptData, statusText, currentChunkIndex, totalChunks: chunks.length, clearCheckpoint };
};