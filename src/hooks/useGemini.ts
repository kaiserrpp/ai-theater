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

  // 1. Descubrimiento de modelos
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
      } catch (err) {} // Silencioso para no ensuciar la pantalla si tarda
    };
    fetchModels();
  }, []);

  // 2. Función para subir archivos pesados sin usar memoria local
  const uploadToGemini = async (localUri: string, mimeType: string) => {
    try {
      // Obtenemos el archivo puro desde el móvil (sin Base64)
      const fileResp = await fetch(localUri);
      const blob = await fileResp.blob();

      // Lo subimos directamente al servidor de archivos de Google
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
        throw new Error(data.error?.message || "Error en el servidor de subida");
      }
      return data.file.uri; // Este es el enlace interno que usará la IA
    } catch (e: any) {
      throw new Error(`Fallo al subir el archivo: ${e.message}`);
    }
  };

  // 3. El análisis
  const analyzeScript = async (localUri: string, mimeType: string) => {
    setLoading(true);
    setError(null);
    setScriptData(null);

    if (availableModels.length === 0) {
      setError("Esperando conexión con Google...");
      setLoading(false);
      return;
    }

    try {
      console.log("⬆️ Subiendo PDF de forma optimizada a Google...");
      const geminiFileUri = await uploadToGemini(localUri, mimeType);
      console.log("✅ PDF Subido. URI interna:", geminiFileUri);

      const promptText = `Extract script data from this document into strict JSON: {"obra": "string", "personajes": ["string"], "guion": [{"p": "string", "t": "string", "a": "string"}]}. Respond ONLY with valid JSON.`;

      let lastError = "";
      
      // Intentamos con los modelos disponibles
      for (const modelName of availableModels) {
        try {
          console.log(`🚀 Procesando texto con: ${modelName}`);
          const model = genAI.getGenerativeModel({ 
            model: modelName,
            generationConfig: { responseMimeType: "application/json" }
          });

          // AHORA PASAMOS LA URI DEL ARCHIVO, NO EL ARCHIVO ENTERO
          const result = await model.generateContent([
            { text: promptText },
            { fileData: { mimeType, fileUri: geminiFileUri } }
          ]);

          const response = await result.response;
          const text = response.text();
          
          const start = text.indexOf('{');
          const end = text.lastIndexOf('}') + 1;
          setScriptData(JSON.parse(text.substring(start, end)));
          setLoading(false);
          return; // ¡ÉXITO!

        } catch (err: any) {
          lastError = err.message;
          if (lastError.includes("429")) await wait(2500);
        }
      }
      setError(`Agotados modelos disponibles. Último error: ${lastError}`);
    } catch (err: any) {
      setError(`Error general: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return { analyzeScript, loading, error, scriptData, setScriptData };
};