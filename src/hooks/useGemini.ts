import { GoogleGenerativeAI } from '@google/generative-ai';
import { useState } from 'react';

export interface Dialogue { p: string; t: string; a: string; }
export interface ScriptData { obra: string; personajes: string[]; guion: Dialogue[]; }

const apiKey = process.env.EXPO_PUBLIC_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const useGemini = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptData, setScriptData] = useState<ScriptData | null>(null);

  const promptText = `
    Actúa como un extractor de datos estructurados especializado en guiones teatrales.
    Transforma el documento proporcionado en un objeto JSON estricto con las claves "obra", "personajes" (array de nombres) y "guion" (array de objetos {p, t, a}).
  `;

  const getCompatibleModels = async () => {
    try {
      const result = await genAI.listModels();
      return result.models
        .filter(m => m.supportedGenerationMethods.includes('generateContent'))
        .filter(m => m.name.includes('flash') || m.name.includes('pro'))
        .sort((a, b) => a.name.includes('flash') ? -1 : 1)
        .map(m => m.name);
    } catch (e) {
      return ['models/gemini-1.5-flash', 'models/gemini-2.0-flash'];
    }
  };

  const processPayload = async (contentPayload: any[]) => {
    setLoading(true);
    setError(null);
    setScriptData(null);

    if (!apiKey) {
      setError("DEBUG: Falta API KEY en Vercel.");
      setLoading(false);
      return;
    }

    try {
      const availableModels = await getCompatibleModels();
      let lastRawError = "";

      for (const modelId of availableModels) {
        try {
          console.log(`Intentando: ${modelId}`);
          const model = genAI.getGenerativeModel({ 
              model: modelId,
              generationConfig: { responseMimeType: "application/json" }
          });

          const result = await model.generateContent(contentPayload);
          const response = await result.response;
          const text = response.text();
          
          setScriptData(JSON.parse(text));
          setLoading(false);
          return; 

        } catch (err: any) {
          // CAPTURA DE DIAGNÓSTICO PROFUNDO
          const errorDetails = {
            message: err.message,
            status: err.status,
            name: err.name,
            stack: err.stack?.split('\n')[0] // Solo la primera línea del stack
          };
          
          lastRawError = JSON.stringify(errorDetails);
          console.error("Error en modelo:", lastRawError);

          if (err.message?.includes("429")) {
              setError(`CUOTA AGOTADA (429): Google dice que vas muy rápido. Detalles: ${lastRawError}`);
              setLoading(false);
              return;
          }
          
          await sleep(2000); 
        }
      }

      setError(`FALLO TOTAL EN TODOS LOS MODELOS. Último error: ${lastRawError}`);
    } catch (rootErr: any) {
      setError(`ERROR CRÍTICO INICIAL: ${rootErr.message}`);
    } finally {
      setLoading(false);
    }
  };

  const analyzePdf = (base64String: string) => {
    processPayload([
      { text: promptText },
      { inlineData: { data: base64String, mimeType: "application/pdf" } }
    ]);
  };

  return { analyzePdf, loading, error, scriptData, setScriptData };
};