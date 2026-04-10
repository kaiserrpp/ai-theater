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
      if (!API_KEY) {
        setError("Error crítico: No hay API_KEY configurada."); return;
      }
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || `Error HTTP: ${response.status}`);

        if (data.models) {
          const utiles = data.models
            .filter((m: any) => m.supportedGenerationMethods.includes('generateContent'))
            .map((m: any) => m.name.replace('models/', ''));
          
          if (utiles.length === 0) setError("Google NO devolvió modelos válidos.");
          else setAvailableModels(utiles);
        }
      } catch (err: any) {
        setError(`Excepción: ${err.message}`);
      }
    };
    fetchModels();
  }, []);

  const uploadAndWaitForActive = async (localUri: string, mimeType: string) => {
    try {
      setStatusText("Empaquetando PDF...");
      const fileResp = await fetch(localUri);
      const blob = await fileResp.blob();

      setStatusText("Enviando PDF a Google...");
      const uploadResp = await fetch(
        `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`,
        { method: 'POST', headers: { 'X-Goog-Upload-Protocol': 'raw', 'X-Goog-Upload-Header-Content-Type': mimeType, 'Content-Type': mimeType }, body: blob }
      );

      const uploadData = await uploadResp.json();
      if (!uploadResp.ok) throw new Error(uploadData.error?.message || "Error al subir");

      const fileUri = uploadData.file.uri;
      const fileName = uploadData.file.name;

      setStatusText("Google procesando el guion...");
      let isReady = false;
      let attempts = 0;
      
      while (!isReady && attempts < 20) { 
        await wait(3000);
        attempts++;
        setStatusText(`Google procesando guion... (Comprobación ${attempts})`);
        const checkResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${API_KEY}`);
        const checkData = await checkResp.json();
        if (checkData.state === "ACTIVE") isReady = true;
        else if (checkData.state === "FAILED") throw new Error("Google falló al procesar el PDF.");
      }

      if (!isReady) throw new Error("Tiempo de espera agotado en Google.");
      return fileUri;
    } catch (e: any) {
      throw new Error(`${e.message}`);
    }
  };

  const tryAllModels = async (prompt: string, fileUri: string, requireJson: boolean = true) => {
    let lastErr = "";
    for (const modelName of availableModels) {
      try {
        const config: any = { maxOutputTokens: 8192 };
        if (requireJson) config.responseMimeType = "application/json";
        const model = genAI.getGenerativeModel({ model: modelName, generationConfig: config });
        const result = await model.generateContent([{ text: prompt }, { fileData: { mimeType: 'application/pdf', fileUri } }]);
        return result.response.text();
      } catch (err: any) {
        lastErr = err.message;
        if (lastErr.includes("429") || lastErr.includes("503")) await wait(4000);
        else await wait(1500);
      }
    }
    throw new Error(`Agotados los modelos. Último error: ${lastErr}`);
  };

  const analyzeInStages = async (localUri: string, mimeType: string) => {
    setLoading(true); setError(null); setScriptData(null);
    if (availableModels.length === 0) {
        setError("No hay modelos de Google válidos."); setLoading(false); return;
    }

    try {
      const fileUri = await uploadAndWaitForActive(localUri, mimeType);

      setStatusText("Analizando estructura del documento...");
      const indexPrompt = `Analiza este documento y extrae un índice secuencial de todas las escenas. 
      Devuelve ÚNICAMENTE un array JSON válido de strings. Ejemplo: ["Acto 1 - Escena 1", "Escena 2"]. No devuelvas nada más.`;
      
      const indexText = await tryAllModels(indexPrompt, fileUri, true);
      const startIdx = indexText.indexOf('[');
      const endIdx = indexText.lastIndexOf(']') + 1;
      const escenas = JSON.parse(indexText.substring(startIdx, endIdx));
      setChunks(escenas);
      
      if (!Array.isArray(escenas) || escenas.length === 0) throw new Error("No se detectaron escenas.");

      let finalGuion: Dialogue[] = [];
      let finalPersonajes = new Set<string>();
      let obraTitle = "Obra Procesada";

      for (let i = 0; i < escenas.length; i++) {
        setCurrentChunkIndex(i);
        setStatusText(`Extrayendo: ${escenas[i]} (${i + 1}/${escenas.length})...`);
        
        const scenePrompt = `Extrae los diálogos ÚNICAMENTE de "${escenas[i]}".
        Devuelve SOLO JSON estricto: {"obra": "titulo", "personajes": ["P1"], "guion": [{"p":"PERSONAJE", "t":"texto", "a":"acotacion"}]}`;
        
        try {
          const chunkText = await tryAllModels(scenePrompt, fileUri, true);
          const start = chunkText.indexOf('{');
          const end = chunkText.lastIndexOf('}') + 1;
          const chunkData = JSON.parse(chunkText.substring(start, end));

          if (i === 0 && chunkData.obra) obraTitle = chunkData.obra;
          chunkData.personajes?.forEach((p: string) => finalPersonajes.add(p));
          
          if (chunkData.guion && Array.isArray(chunkData.guion)) {
             // MARCADOR DE ESCENA INYECTADO AQUÍ
             const sceneMarker: Dialogue = { p: 'ESCENA_SISTEMA', t: escenas[i], a: '' };
             finalGuion = [...finalGuion, sceneMarker, ...chunkData.guion];
          }
          
          setScriptData({ obra: obraTitle, personajes: Array.from(finalPersonajes), guion: finalGuion });
          
        } catch (e: any) {
          console.warn(`Error en ${escenas[i]}:`, e.message);
          setStatusText(`Saltando "${escenas[i]}"...`);
          await wait(2000);
        }
      }

      setStatusText("¡Proceso completado!");
      setLoading(false);

    } catch (err: any) {
      setError(`${err.message}`);
      setLoading(false);
    }
  };

  return { analyzeInStages, loading, error, scriptData, setScriptData, statusText, currentChunkIndex, totalChunks: chunks.length };
};