import { GoogleGenerativeAI } from '@google/generative-ai';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

export interface Dialogue { p: string; t: string; a: string; }
export interface ScriptData { obra: string; personajes: string[]; guion: Dialogue[]; }

const API_KEY = process.env.EXPO_PUBLIC_API_KEY || '';
const genAI = new GoogleGenerativeAI(API_KEY);
const STORAGE_KEY = '@pending_job';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// FUNCIÓN AUXILIAR PARA LIMPIAR JSON DE IA
const cleanJSON = (text: string) => {
  // Elimina bloques de código Markdown como ```json o ```
  let clean = text.replace(/```json/g, '').replace(/```/g, '').trim();
  // Busca el primer '{' o '[' y el último '}' o ']'
  const startBrace = clean.indexOf('{');
  const startBracket = clean.indexOf('[');
  const endBrace = clean.lastIndexOf('}') + 1;
  const endBracket = clean.lastIndexOf(']') + 1;

  let start = -1;
  let end = -1;

  if (startBrace !== -1 && (startBracket === -1 || startBrace < startBracket)) {
    start = startBrace;
    end = endBrace;
  } else {
    start = startBracket;
    end = endBracket;
  }

  if (start === -1 || end === 0) return clean;
  return clean.substring(start, end);
};

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
        if (!uploadResp.ok) throw new Error("Error de subida.");
        
        currentFileUri = uploadData.file.uri;
        const fileName = uploadData.file.name;

        setStatusText("Esperando a Google...");
        let active = false;
        while(!active) {
          await wait(3000);
          const c = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${API_KEY}`);
          const d = await c.json();
          if (d.state === "ACTIVE") active = true;
          else if (d.state === "FAILED") throw new Error("Archivo fallido en Google.");
        }

        setStatusText("Mapeando escenas...");
        let indexText = "";
        for (const m of modelsToTry) {
           try {
             const model = genAI.getGenerativeModel({ model: m });
             const res = await model.generateContent([
                { text: 'Devuelve un array JSON de strings con los nombres de las escenas de este PDF. SOLO el array, sin texto extra.' }, 
                { fileData: { mimeType: 'application/pdf', fileUri: currentFileUri } }
             ]);
             indexText = res.response.text();
             if (indexText) break;
           } catch(e) { await wait(2000); }
        }
        
        sceneList = JSON.parse(cleanJSON(indexText));
      }

      setChunks(sceneList);
      setScriptData({...currentScript});

      for (let i = startAt; i < sceneList.length; i++) {
        setCurrentChunkIndex(i);
        setStatusText(`Escena ${i + 1} de ${sceneList.length}...`);
        
        const scenePrompt = `Transcribe íntegro y literal el texto de la escena "${sceneList[i]}". JSON: {"obra":"t", "personajes":["P1"], "guion":[{"p":"P", "t":"t", "a":"a"}]}`;

        let chunkData;
        for (const modelName of modelsToTry) {
           try {
              const model = genAI.getGenerativeModel({ model: modelName, generationConfig: { responseMimeType: "application/json", temperature: 0.1 } });
              const res = await model.generateContent([{ text: scenePrompt }, { fileData: { mimeType: 'application/pdf', fileUri: currentFileUri } }]);
              const t = res.response.text();
              chunkData = JSON.parse(cleanJSON(t));
              break;
           } catch (e) { await wait(2000); }
        }
        
        if(!chunkData) throw new Error("Error al procesar escena.");

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
      setError(`Error de lectura: ${err.message}`); 
      setLoading(false); 
    }
  };

  return { analyzeInStages, loading, error, scriptData, setScriptData, statusText, currentChunkIndex, totalChunks: chunks.length, clearCheckpoint };
};