import { GoogleGenerativeAI } from '@google/generative-ai';
import { useState } from 'react';

export interface Dialogue { p: string; t: string; a: string; }
export interface ScriptData { obra: string; personajes: string[]; guion: Dialogue[]; }

const apiKey = process.env.EXPO_PUBLIC_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

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

  // --- FUNCIÓN DE AUTODESCUBRIMIENTO ---
  const getCompatibleModels = async () => {
    try {
      const result = await genAI.listModels();
      // Filtramos modelos que:
      // 1. Permitan generar contenido
      // 2. Sean "flash" o "pro" (que suelen soportar archivos)
      // 3. NO sean modelos antiguos o de solo texto
      const compatible = result.models
        .filter(m => m.supportedGenerationMethods.includes('generateContent'))
        .filter(m => m.name.includes('flash') || m.name.includes('pro'))
        // Ordenamos para que los "flash" vayan primero (son más rápidos y baratos)
        .sort((a, b) => a.name.includes('flash') ? -1 : 1);
      
      return compatible.map(m => m.name);
    } catch (e) {
      console.error("Error listando modelos:", e);
      // Si falla el listado, usamos un fallback seguro
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

    // 1. Descubrimos qué modelos hay disponibles hoy
    const availableModels = await getCompatibleModels();
    console.log("Modelos detectados:", availableModels);

    let lastErrorMsg = "";

    // 2. Intentamos con los modelos encontrados
    for (const modelId of availableModels) {
      try {
        console.log(`🤖 Probando descubrimiento automático: ${modelId}`);
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
        console.warn(`⚠️ Modelo ${modelId} falló o no es compatible.`);
        
        if (err.message.includes("429")) {
            setError("Cuota agotada. Espera 60 segundos.");
            setLoading(false);
            return;
        }
      }
    }

    setError(`No se encontró ningún modelo compatible activo: ${lastErrorMsg}`);
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