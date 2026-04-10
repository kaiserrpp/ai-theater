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
      setStatusText("Subiendo PDF a Google...");
      const fileResp = await fetch(localUri);
      const blob = await fileResp.blob();

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
      if (!uploadResp.ok) throw new Error(data.error?.message || "Error al subir");
      return data.file.uri; 
    } catch (e: any) {
      throw new Error(`Error en subida: ${e.message}`);
    }
  };

  // --- EXPERIMENTO: SOLO PERSONAJES ---
  const analyzeCharactersOnly = async (localUri: string, mimeType: string) => {
    setLoading(true); setError(null); setScriptData(null);
    setStatusText("Iniciando prueba de velocidad (Solo Personajes)...");

    try {
      const geminiFileUri = await uploadToGemini(localUri, mimeType);
      setStatusText("Esperando digestión de Google (5s)...");
      await wait(5000);

      // Prompt mínimo: Salida muy pequeña
      const promptText = `Extract ONLY the title and unique character names. Format: {"obra": "string", "personajes": ["string"], "guion": []}`;

      for (const modelName of availableModels) {
        try {
          setStatusText(`Analizando personajes con ${modelName}...`);
          const model = genAI.getGenerativeModel({ model: modelName });
          const result = await model.generateContent([{ text: promptText }, { fileData: { mimeType, fileUri: geminiFileUri } }]);
          const response = await result.response;
          const text = response.text();
          
          const start = text.indexOf('{');
          const end = text.lastIndexOf('}') + 1;
          setScriptData(JSON.parse(text.substring(start, end)));
          setLoading(false);
          return;
        } catch (err: any) {
          console.warn(err);
        }
      }
      setError("No se pudo obtener la lista de personajes.");
    } catch (err: any) {
      setError(err.message);
    } finally { setLoading(false); }
  };

  // --- FUNCIÓN ORIGINAL (OBRA COMPLETA) ---
  const analyzeScript = async (localUri: string, mimeType: string) => {
    setLoading(true); setError(null); setScriptData(null);
    try {
      const geminiFileUri = await uploadToGemini(localUri, mimeType);
      setStatusText("Procesando PDF completo (Esto es lo que tarda)...");
      await wait(5000);

      const promptText = `Extract EVERYTHING. No summary. Format: {"obra": "string", "personajes": ["string"], "guion": [{"p": "string", "t": "string", "a": "string"}]}`;

      for (const modelName of availableModels) {
        try {
          setStatusText(`Generando guion completo con ${modelName}...`);
          const model = genAI.getGenerativeModel({ 
            model: modelName, 
            generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 } 
          });
          const result = await model.generateContent([{ text: promptText }, { fileData: { mimeType, fileUri: geminiFileUri } }]);
          const response = await result.response;
          const text = response.text();
          const start = text.indexOf('{');
          const end = text.lastIndexOf('}') + 1;
          setScriptData(JSON.parse(text.substring(start, end)));
          setLoading(false);
          return;
        } catch (err: any) { console.warn(err); }
      }
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  };

  return { analyzeScript, analyzeCharactersOnly, loading, error, scriptData, setScriptData, statusText };
};