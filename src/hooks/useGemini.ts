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

    try {
      if (!resumeData && localUri) {
        setStatusText("Subiendo PDF...");
        const fileResp = await fetch(localUri);
        const blob = await fileResp.blob();
        const uploadResp = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`, {
          method: 'POST', headers: { 'X-Goog-Upload-Protocol': 'raw', 'X-Goog-Upload-Header-Content-Type': 'application/pdf' }, body: blob
        });
        const uploadData = await uploadResp.json();
        currentFileUri = uploadData.file.uri;
        const fileName = uploadData.file.name;

        while(true) {
          await wait(3000);
          const c = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${API_KEY}`);
          const d = await c.json();
          if (d.state === "ACTIVE") break;
        }

        setStatusText("Mapeando escenas...");
        const model = genAI.getGenerativeModel({ model: availableModels[0] || "gemini-1.5-flash" });
        const res = await model.generateContent([{ text: 'JSON array of scene names: ["Scene 1", ...]' }, { fileData: { mimeType: 'application/pdf', fileUri: currentFileUri } }]);
        const t = res.response.text();
        sceneList = JSON.parse(t.substring(t.indexOf('['), t.lastIndexOf(']') + 1));
      }

      setChunks(sceneList);
      setScriptData({...currentScript});

      for (let i = startAt; i < sceneList.length; i++) {
        setCurrentChunkIndex(i);
        setStatusText(`Extrayendo ${sceneList[i]}...`);
        const model = genAI.getGenerativeModel({ model: availableModels[0] || "gemini-1.5-flash", generationConfig: { responseMimeType: "application/json", temperature: 0.1 } });
        const res = await model.generateContent([{ text: `Extrae diálogos íntegros de "${sceneList[i]}" en JSON: {"obra":"t", "personajes":["P1"], "guion":[{"p":"P", "t":"t", "a":"a"}]}. NO RESUMAS.` }, { fileData: { mimeType: 'application/pdf', fileUri: currentFileUri } }]);
        const t = res.response.text();
        const chunkData = JSON.parse(t.substring(t.indexOf('{'), t.lastIndexOf('}') + 1));

        // ACTUALIZACIÓN DE PERSONAJES SIN DUPLICADOS
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
    } catch (err: any) { setError(err.message); setLoading(false); }
  };

  return { analyzeInStages, loading, error, scriptData, setScriptData, statusText, currentChunkIndex, totalChunks: chunks.length, clearCheckpoint };
};