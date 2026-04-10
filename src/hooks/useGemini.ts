import { GoogleGenerativeAI } from '@google/generative-ai';
import * as pdfjsLib from 'pdfjs-dist';
import { useEffect, useState } from 'react';

// Configuramos el "trabajador" de PDF.js usando un CDN para evitar problemas de empaquetado en Vercel
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

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

  // --- NUEVA MAGIA: EXTRACCIÓN DE TEXTO 100% LOCAL ---
  const extractTextLocally = async (fileUri: string) => {
    try {
      setStatusText("Leyendo el PDF localmente en tu dispositivo...");
      const loadingTask = pdfjsLib.getDocument(fileUri);
      const pdf = await loadingTask.promise;
      
      let fullText = '';
      setStatusText(`Extrayendo texto de ${pdf.numPages} páginas...`);
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        // Unimos el texto de la página
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        fullText += pageText + '\n\n';
      }
      
      return fullText;
    } catch (err: any) {
      throw new Error(`Fallo al leer el PDF localmente: ${err.message}`);
    }
  };

  const tryAllModels = async (prompt: string, requireJson: boolean = true) => {
    let lastErr = "";
    for (const modelName of availableModels) {
      try {
        const config: any = { maxOutputTokens: 8192 };
        if (requireJson) config.responseMimeType = "application/json";

        const model = genAI.getGenerativeModel({ model: modelName, generationConfig: config });
        const result = await model.generateContent(prompt);
        return result.response.text();
      } catch (err: any) {
        lastErr = err.message;
        if (lastErr.includes("429") || lastErr.includes("503")) {
          await wait(3000);
        } else {
          await wait(1000);
        }
      }
    }
    throw new Error(`Agotados modelos. Último error: ${lastErr}`);
  };

  const analyzeInStages = async (localUri: string) => {
    setLoading(true);
    setError(null);
    setScriptData(null);
    
    try {
      // 1. OBTENER EL TEXTO LOCALMENTE (¡Adiós Google File API!)
      const fullText = await extractTextLocally(localUri);

      // 2. TROCEAR POR ESCENAS
      setStatusText("Troceando el guion por escenas...");
      const sceneMarkers = /(?=ESCENA|ACTO|INT\.|EXT\.)/gi;
      const rawChunks = fullText.split(sceneMarkers).filter(c => c.trim().length > 50);
      setChunks(rawChunks);
      
      if (rawChunks.length === 0) {
          throw new Error("No se detectaron 'ESCENAS' o 'ACTOS'. El PDF podría ser una imagen escaneada sin texto.");
      }

      let finalGuion: Dialogue[] = [];
      let finalPersonajes = new Set<string>();
      let obraTitle = "Obra Procesada";

      // 3. PROCESAR CADA TROZO 
      for (let i = 0; i < rawChunks.length; i++) {
        setCurrentChunkIndex(i);
        setStatusText(`Analizando Escena ${i + 1} de ${rawChunks.length}...`);
        
        const prompt = `Extrae diálogos de esta escena en JSON. 
        Formato: {"obra": "titulo", "personajes": ["P1"], "guion": [{"p":"PERSONAJE", "t":"texto", "a":"acotacion"}]}
        
        TEXTO DE LA ESCENA:
        ${rawChunks[i]}`;
        
        try {
          const chunkText = await tryAllModels(prompt, true);
          
          const start = chunkText.indexOf('{');
          const end = chunkText.lastIndexOf('}') + 1;
          const chunkData = JSON.parse(chunkText.substring(start, end));

          if (i === 0) obraTitle = chunkData.obra || obraTitle;
          chunkData.personajes?.forEach((p: string) => finalPersonajes.add(p));
          
          if (chunkData.guion && Array.isArray(chunkData.guion)) {
             finalGuion = [...finalGuion, ...chunkData.guion];
          }
          
          // GUARDAR PROGRESO (Checkpoint en vivo)
          setScriptData({ 
            obra: obraTitle, 
            personajes: Array.from(finalPersonajes), 
            guion: finalGuion 
          });
          
        } catch (e: any) {
          console.error(`Fallo total en la escena ${i+1}:`, e.message);
          setStatusText(`Saltando escena ${i+1} por error...`);
          await wait(2000);
        }
      }

      setStatusText("¡Proceso completado con éxito!");
      setLoading(false);

    } catch (err: any) {
      setError(`${err.message}`);
      setLoading(false);
    }
  };

  // Solo exponemos lo necesario
  return { analyzeInStages, loading, error, scriptData, setScriptData, statusText, currentChunkIndex, totalChunks: chunks.length };
};