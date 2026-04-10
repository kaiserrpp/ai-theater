import { GoogleGenerativeAI } from '@google/generative-ai';
import { useEffect, useState } from 'react';

export interface Dialogue { p: string; t: string; a: string; }
export interface ScriptData { obra: string; personajes: string[]; guion: Dialogue[]; }

const API_KEY = process.env.EXPO_PUBLIC_API_KEY || '';
const genAI = new GoogleGenerativeAI(API_KEY);

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
      if (!API_KEY) return;
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

  const uploadAndWaitForActive = async (localUri: string, mimeType: string) => {
    const fileResp = await fetch(localUri);
    const blob = await fileResp.blob();
    const uploadResp = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'X-Goog-Upload-Protocol': 'raw', 'X-Goog-Upload-Header-Content-Type': mimeType, 'Content-Type': mimeType },
      body: blob
    });
    const uploadData = await uploadResp.json();
    const fileUri = uploadData.file.uri;
    const fileName = uploadData.file.name;

    let isReady = false;
    let attempts = 0;
    while (!isReady && attempts < 20) { 
      await wait(3000);
      attempts++;
      setStatusText(`Preparando guion en Google... (${attempts})`);
      const checkResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${API_KEY}`);
      const checkData = await checkResp.json();
      if (checkData.state === "ACTIVE") isReady = true;
    }
    return fileUri;
  };

  const tryAllModels = async (prompt: string, fileUri: string) => {
    let lastErr = "";
    for (const modelName of availableModels) {
      try {
        const model = genAI.getGenerativeModel({ 
          model: modelName, 
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 } 
        });
        const result = await model.generateContent([{ text: prompt }, { fileData: { mimeType: 'application/pdf', fileUri } }]);
        return result.response.text();
      } catch (err: any) {
        lastErr = err.message;
        await wait(2000);
      }
    }
    throw new Error(lastErr);
  };

  const analyzeInStages = async (localUri: string, mimeType: string) => {
    setLoading(true); setError(null); setScriptData(null);
    try {
      const fileUri = await uploadAndWaitForActive(localUri, mimeType);
      setStatusText("Analizando estructura de escenas...");
      
      const indexPrompt = `Analiza el documento y devuelve un array JSON de las escenas/actos: ["Escena 1", "Escena 2"...]`;
      const indexText = await tryAllModels(indexPrompt, fileUri);
      const escenas = JSON.parse(indexText.substring(indexText.indexOf('['), indexText.lastIndexOf(']') + 1));
      setChunks(escenas);

      let finalGuion: Dialogue[] = [];
      let finalPersonajes = new Set<string>();
      let obraTitle = "Mi Obra";

      for (let i = 0; i < escenas.length; i++) {
        setCurrentChunkIndex(i);
        setStatusText(`Procesando: ${escenas[i]}`);
        
        const scenePrompt = `Extrae diálogos de "${escenas[i]}" en JSON: {"obra":"t", "personajes":["P1"], "guion":[{"p":"P", "t":"t", "a":"a"}]}`;
        try {
          const chunkText = await tryAllModels(scenePrompt, fileUri);
          const chunkData = JSON.parse(chunkText.substring(chunkText.indexOf('{'), chunkText.lastIndexOf('}') + 1));

          if (i === 0) obraTitle = chunkData.obra || obraTitle;
          chunkData.personajes?.forEach((p: string) => finalPersonajes.add(p.trim().toUpperCase()));
          
          if (chunkData.guion) {
            finalGuion = [...finalGuion, ...chunkData.guion];
          }

          // Actualización en tiempo real para la UI
          setScriptData({
            obra: obraTitle,
            personajes: Array.from(finalPersonajes).sort(),
            guion: finalGuion
          });
        } catch (e) {
          console.warn("Error en escena", i);
        }
      }
      setStatusText("Completado");
      setLoading(false);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return { analyzeInStages, loading, error, scriptData, setScriptData, statusText, currentChunkIndex, totalChunks: chunks.length };
};