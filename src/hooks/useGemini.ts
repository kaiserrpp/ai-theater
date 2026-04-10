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
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  
  // NUEVO: Estado para saber qué está haciendo la app exactamente
  const [statusText, setStatusText] = useState<string>("");

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
    try {
      setStatusText("Paso 1: Preparando el archivo local...");
      const fileResp = await fetch(localUri);
      const blob = await fileResp.blob();

      setStatusText("Paso 2: Subiendo archivo pesado a Google...");
      const uploadResp = await fetch(
        `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`,
        {
          method: 'POST',
          headers: {
            'X-Goog-Upload-Protocol': 'raw',
            'X-Goog-Upload-Header-Content-Type': mimeType,
            'Content-Type': mimeType
          },
          body: blob
        }
      );

      const data = await uploadResp.json();
      if (!uploadResp.ok) {
        throw new Error(data.error?.message || "Error en el servidor de subida de Google");
      }
      return data.file.uri; 
    } catch (e: any) {
      throw new Error(`Fallo al subir el archivo: ${e.message}`);
    }
  };

  const analyzeScript = async (localUri: string, mimeType: string) => {
    setLoading(true);
    setError(null);
    setScriptData(null);
    setStatusText("Iniciando proceso...");

    if (availableModels.length === 0) {
      setError("Esperando conexión con Google. Revisa tu red o API Key.");
      setLoading(false);
      return;
    }

    try {
      // 1. Subida
      const geminiFileUri = await uploadToGemini(localUri, mimeType);
      
      const promptText = `Extract script data from this document into strict JSON: {"obra": "string", "personajes": ["string"], "guion": [{"p": "string", "t": "string", "a": "string"}]}. Respond ONLY with valid JSON.`;

      let lastError = "";
      
      // 2. Análisis
      for (const modelName of availableModels) {
        try {
          setStatusText(`Paso 3: Analizando con IA (${modelName})...`);
          
          const model = genAI.getGenerativeModel({ 
            model: modelName,
            generationConfig: { responseMimeType: "application/json" }
          });

          const result = await model.generateContent([
            { text: promptText },
            { fileData: { mimeType, fileUri: geminiFileUri } }
          ]);

          setStatusText("Paso 4: Procesando respuesta...");
          const response = await result.response;
          const text = response.text();
          
          const start = text.indexOf('{');
          const end = text.lastIndexOf('}') + 1;
          setScriptData(JSON.parse(text.substring(start, end)));
          
          setLoading(false);
          return; 

        } catch (err: any) {
          lastError = err.message;
          if (lastError.includes("429")) {
             setStatusText("Límite alcanzado. Esperando 3 segundos para reintentar...");
             await wait(3000);
          }
        }
      }
      setError(`Agotados modelos disponibles. Último error: ${lastError}`);
    } catch (err: any) {
      setError(`Error general: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return { analyzeScript, loading, error, scriptData, setScriptData, statusText };
};