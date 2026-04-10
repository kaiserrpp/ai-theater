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
          const utiles = data.models.filter((m: any) => m.supportedGenerationMethods.includes('generateContent')).map((m: any) => m.name.replace('models/', ''));
          setAvailableModels(utiles);
        }
      } catch (err) {}
    };
    fetchModels();
  }, []);

  const clearCheckpoint = async () => { await AsyncStorage.removeItem(STORAGE_KEY); };

  const analyzeInStages = async (localUri: string | null, resumeData?: any) => {
    setLoading(true); setError(null);
    let currentFileUri = resumeData?.fileUri || "";
    let startAt = resumeData ? resumeData.index + 1 : 0;
    let sceneList = resumeData?.totalChunks || [];
    let currentScript: ScriptData = resumeData?.data || { obra: "Procesando...", personajes: [], guion: [] };

    // Cinturón de seguridad por si falla la carga inicial de modelos
    const modelsToTry = availableModels.length > 0 ? availableModels : ['gemini-1.5-flash', 'gemini-1.5-pro'];

    try {
      if (!resumeData && localUri) {
        setStatusText("Subiendo PDF...");
        const fileResp = await fetch(localUri);
        const blob = await fileResp.blob();
        const uploadResp = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`, {
          method: 'POST', headers: { 'X-Goog-Upload-Protocol': 'raw', 'X-Goog-Upload-Header-Content-Type': 'application/pdf' }, body: blob
        });
        const uploadData = await uploadResp.json();
        if (!uploadResp.ok) throw new Error("Error al subir archivo a Google.");
        
        currentFileUri = uploadData.file.uri;
        const fileName = uploadData.file.name;

        setStatusText("Esperando a Google...");
        let active = false;
        let attempts = 0;
        while(!active && attempts < 20) {
          await wait(3000);
          attempts++;
          const c = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${API_KEY}`);
          const d = await c.json();
          if (d.state === "ACTIVE") active = true;
          else if (d.state === "FAILED") throw new Error("Google falló al procesar el archivo. Puede estar corrupto o protegido.");
        }
        if (!active) throw new Error("Tiempo de espera agotado en los servidores de Google.");

        setStatusText("Mapeando escenas...");
        let indexText = "";
        for (const m of modelsToTry) {
           try {
             const model = genAI.getGenerativeModel({ model: m });
             // PROMPT RESTAURADO Y BLINDADO
             const res = await model.generateContent([
                { text: 'Analiza este documento y extrae un índice secuencial de todas las escenas. Devuelve ÚNICAMENTE un array JSON válido de strings. Ejemplo: ["Acto 1", "Escena 2"]. No devuelvas texto extra.' }, 
                { fileData: { mimeType: 'application/pdf', fileUri: currentFileUri } }
             ]);
             indexText = res.response.text();
             break;
           } catch(e) { await wait(1500); }
        }
        
        if (!indexText) throw new Error("La IA no pudo crear el índice de escenas.");
        const startIdx = indexText.indexOf('[');
        const endIdx = indexText.lastIndexOf(']') + 1;
        if (startIdx === -1) throw new Error("El modelo no devolvió un formato JSON válido para las escenas.");
        
        sceneList = JSON.parse(indexText.substring(startIdx, endIdx));
      }

      setChunks(sceneList);
      setScriptData({...currentScript});

      for (let i = startAt; i < sceneList.length; i++) {
        setCurrentChunkIndex(i);
        setStatusText(`Extrayendo: ${sceneList[i]}...`);
        
        const scenePrompt = `INSTRUCCIÓN CRÍTICA: Actúa como un copista literal. Busca en el documento la parte EXACTA correspondiente a la escena "${sceneList[i]}".
        Tu tarea es transcribir PALABRA POR PALABRA todos los diálogos de esa escena.
        REGLAS:
        1. NO asumas nada, NO resumas, NO saltes líneas.
        2. Copia desde la primera palabra hasta la última de la escena.
        3. Formato estricto JSON: {"obra":"Título", "personajes":["P1", "P2"], "guion":[{"p":"PERSONAJE", "t":"texto exacto", "a":"acotacion"}]}`;

        let chunkData;
        for (const modelName of modelsToTry) {
           try {
              const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: "application/json", temperature: 0.0 } });
              const res = await model.generateContent([{ text: scenePrompt }, { fileData: { mimeType: 'application/pdf', fileUri: currentFileUri } }]);
              const t = res.response.text();
              chunkData = JSON.parse(t.substring(t.indexOf('{'), t.lastIndexOf('}') + 1));
              break;
           } catch (e) { await wait(2000); }
        }
        
        if(!chunkData) throw new Error(`Fallo al extraer la escena "${sceneList[i]}" tras varios intentos con la IA.`);

        const updatedPersonajes = [...currentScript.personajes];
        chunkData.personajes?.forEach((p: string) => {
          const up = p.trim().toUpperCase();
          if (!updatedPersonajes.includes(up)) updatedPersonajes.push(up);
        });

        currentScript = {
          obra: i === 0 ? chunkData.obra || currentScript.obra : currentScript.obra,
          personajes: updatedPersonajes.sort(),
          guion: [...currentScript.guion, { p: 'ESCENA_SISTEMA', t: sceneList[i], a: '' }, ...(chunkData.guion || [])]
        };

        setScriptData({...currentScript});
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ data: currentScript, fileUri: currentFileUri, index: i, totalChunks: sceneList }));
      }
      setStatusText("Completado");
      setLoading(false);
    } catch (err: any) { 
      setError(err.message); 
      setLoading(false); 
    }
  };

  return { analyzeInStages, loading, error, scriptData, setScriptData, statusText, currentChunkIndex, totalChunks: chunks.length, clearCheckpoint };
};