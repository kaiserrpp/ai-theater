import { GoogleGenerativeAI } from '@google/generative-ai';
import { useState } from 'react';

export interface Dialogue { p: string; t: string; a: string; }
export interface ScriptData { obra: string; personajes: string[]; guion: Dialogue[]; }

const apiKey = process.env.EXPO_PUBLIC_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

// Función auxiliar para esperar (freno de seguridad)
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const useGemini = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptData, setScriptData] = useState<ScriptData | null>(null);

  const promptText = `
    Actúa como un extractor de datos estructurados especializado en guiones teatrales.
    Transforma el documento proporcionado en un objeto JSON estricto.
    REGLAS:
    1. Extrae personajes únicos en un array "personajes".
    2. Extrae el título en "obra".
    3. Crea un array "guion" con: "p" (PERSONAJE), "t" (texto hablado), "a" (acotación o "").
    FORMATO JSON:
    {
      "obra": "Título",
      "personajes": ["PERSONAJE A"],
      "guion": [ { "p": "PERSONAJE A", "t": "Hola", "a": "entrando" } ]
    }
  `;

  const getCompatibleModels = async () => {
    try {
      const result = await genAI.listModels();
      const compatible = result.models
        .filter(m => m.supportedGenerationMethods.includes('generateContent'))
        .filter(m => m.name.includes('flash') || m.name.includes('pro'))
        .sort((a, b) => a.name.includes('flash') ? -1 : 1);
      
      return compatible.map(m => m.name);
    } catch (e) {
      return ['models/gemini-1.5-flash', 'models/gemini-2.0-flash'];
    }
  };

  const processPayload = async (contentPayload: any[]) => {
    setLoading(true);
    setError(null);
    setScriptData(null);

    if (!apiKey) {
      setError("Falta la API Key en Vercel.");
      setLoading(false);
      return;
    }

    const availableModels = await getCompatibleModels();
    let lastErrorMsg = "";

    for (const modelId of availableModels) {
      try {
        console.log(`🤖 Intentando con freno de seguridad: ${modelId}`);
        const model = genAI.getGenerativeModel({ 
            model: modelId,
            generationConfig: { responseMimeType: "application/json" }
        });

        const result = await model.generateContent(contentPayload);
        const response = await result.response;
        const text = response.text();
        
        const parsedData = JSON.parse(text) as ScriptData;
        setScriptData(parsedData);
        setLoading(false);
        return; 

      } catch (err: any) {
        lastErrorMsg = err.message;
        
        // Si es error de cuota (429), Google nos ha bloqueado temporalmente
        if (err.message.includes("429")) {
            setError("Google dice: 'Vas muy rápido'. Espera 60 segundos sin tocar nada.");
            setLoading(false);
            return;
        }

        // Si es otro error (como el 404), esperamos un poco antes de probar el siguiente modelo
        // para no saturar al vigilante
        console.warn(`Modelo ${modelId} falló. Esperando 2 segundos antes del siguiente...`);
        await sleep(2000); 
      }
    }

    setError(`Agotados todos los intentos: ${lastErrorMsg}`);
    setLoading(false);
  };

  const analyzePdf = (base64String: string) => {
    processPayload([
      { text: promptText },
      { inlineData: { data: base64String, mimeType: "application/pdf" } }
    ]);
  };

  return { analyzePdf, loading, error, scriptData, setScriptData };
};