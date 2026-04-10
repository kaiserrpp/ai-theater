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
  
  // Estados para el progreso del troceado
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

  const uploadToGemini = async (localUri: string, mimeType: string) => {
    const fileResp = await fetch(localUri);
    const blob = await fileResp.blob();
    const uploadResp = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'X-Goog-Upload-Protocol': 'raw', 'X-Goog-Upload-Header-Content-Type': mimeType, 'Content-Type': mimeType },
      body: blob
    });
    const data = await uploadResp.json();
    return data.file.uri;
  };

  // --- NUEVA LÓGICA DE PROCESAMIENTO POR ESCENAS ---
  const analyzeInStages = async (localUri: string, mimeType: string) => {
    setLoading(true);
    setError(null);
    setScriptData(null);
    
    try {
      // 1. OBTENER EL TEXTO PURO PRIMERO
      setStatusText("Extrayendo texto íntegro del PDF...");
      const fileUri = await uploadToGemini(localUri, mimeType);
      await wait(5000); // Digestión

      const model = genAI.getGenerativeModel({ model: availableModels[0] || "gemini-1.5-flash" });
      const textResult = await model.generateContent([
        { text: "Devuelve el texto completo de este PDF, tal cual, sin resúmenes. Si es muy largo, haz lo mejor que puedas." },
        { fileData: { mimeType, fileUri } }
      ]);
      const fullText = textResult.response.text();

      // 2. TROCEAR POR ESCENAS
      // Buscamos "ESCENA", "ACTO", o cambios de escenario (INT./EXT.)
      setStatusText("Troceando el guion por escenas...");
      const sceneMarkers = /(?=ESCENA|ACTO|INT\.|EXT\.)/gi;
      const rawChunks = fullText.split(sceneMarkers).filter(c => c.trim().length > 50);
      setChunks(rawChunks);
      
      let finalGuion: Dialogue[] = [];
      let finalPersonajes = new Set<string>();
      let obraTitle = "Obra Procesada";

      // 3. PROCESAR CADA TROZO CON "CHECKPOINT"
      for (let i = 0; i < rawChunks.length; i++) {
        setCurrentChunkIndex(i);
        setStatusText(`Analizando Escena ${i + 1} de ${rawChunks.length}...`);
        
        const prompt = `Extrae diálogos de esta escena en JSON. 
        Formato: {"obra": "titulo", "personajes": ["P1"], "guion": [{"p":"PERSONAJE", "t":"texto", "a":"acotacion"}]}`;
        
        let success = false;
        let retryCount = 0;

        while (!success && retryCount < 3) {
          try {
            const chunkResult = await model.generateContent(prompt + "\n\nTEXTO:\n" + rawChunks[i]);
            const chunkText = chunkResult.response.text();
            
            const start = chunkText.indexOf('{');
            const end = chunkText.lastIndexOf('}') + 1;
            const chunkData = JSON.parse(chunkText.substring(start, end));

            // Combinar datos
            if (i === 0) obraTitle = chunkData.obra;
            chunkData.personajes.forEach((p: string) => finalPersonajes.add(p));
            finalGuion = [...finalGuion, ...chunkData.guion];
            
            // GUARDAR PROGRESO LOCAL (Checkpoint)
            const partialData = { obra: obraTitle, personajes: Array.from(finalPersonajes), guion: finalGuion };
            setScriptData(partialData); // Actualizamos la UI en tiempo real
            
            success = true;
          } catch (e) {
            retryCount++;
            setStatusText(`Error en escena ${i+1}. Reintento ${retryCount}...`);
            await wait(2000);
          }
        }
      }

      setStatusText("¡Proceso completado con éxito!");
      setLoading(false);

    } catch (err: any) {
      setError(`Fallo en el procesamiento: ${err.message}`);
      setLoading(false);
    }
  };

  return { analyzeInStages, loading, error, scriptData, setScriptData, statusText, currentChunkIndex, totalChunks: chunks.length };
};