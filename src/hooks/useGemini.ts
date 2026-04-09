import { GoogleGenerativeAI } from '@google/generative-ai';
import { useState } from 'react';

export interface Dialogue { p: string; t: string; a: string; }
export interface ScriptData { obra: string; personajes: string[]; guion: Dialogue[]; }

const apiKey = process.env.EXPO_PUBLIC_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

let workingModelName: string | null = null;
let availableModelsCache: string[] = [];

export const useGemini = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptData, setScriptData] = useState<ScriptData | null>(null);

  const fetchAvailableModels = async (): Promise<string[]> => {
    if (availableModelsCache.length > 0) return availableModelsCache;
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      const data = await response.json();
      if (data.models) {
        const validModels = data.models
          .filter((m: any) => m.name.includes('gemini') && m.supportedGenerationMethods?.includes('generateContent'))
          .map((m: any) => m.name.replace('models/', ''));
        availableModelsCache = validModels;
        return validModels;
      }
      return ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    } catch (e) {
      return ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    }
  };

  const promptText = `
    Actúa como un extractor de datos estructurados especializado en guiones teatrales.
    Transforma el documento o texto proporcionado en un objeto JSON estricto.
    REGLAS:
    1. Extrae personajes únicos en un array "personajes".
    2. Extrae el título en "obra" (o "Obra Desconocida").
    3. Crea un array "guion" con pasajes que tengan: "p" (personaje en mayúsculas), "t" (texto hablado), "a" (acotación, o "" si no hay).
    FORMATO ESPERADO OBLIGATORIO:
    {
      "obra": "Título",
      "personajes": ["PERSONAJE A", "PERSONAJE B"],
      "guion": [ { "p": "PERSONAJE A", "t": "Frase", "a": "Entrando" } ]
    }
  `;

  // Lógica central unificada para enviar el prompt (con o sin PDF)
  const processWithGemini = async (contentPayload: any[]) => {
    setLoading(true); setError(null); setScriptData(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (!apiKey) throw new Error('Falta la clave API. Verifica tu archivo .env');

      const modelsToTry = await fetchAvailableModels();
      const orderedModels = workingModelName 
        ? [workingModelName, ...modelsToTry.filter(m => m !== workingModelName)]
        : modelsToTry;

      let success = false;
      let lastError: any = null;

      for (const modelName of orderedModels) {
        console.log(`🧠 Intentando con el modelo: ${modelName}...`);
        try {
          const model = genAI.getGenerativeModel({
            model: modelName,
            generationConfig: { responseMimeType: 'application/json' },
          });

          // AQUÍ ESTÁ LA MAGIA MULTIMODAL
          const result = await model.generateContent(contentPayload);
          const parsedData = JSON.parse(await result.response.text()) as ScriptData;
          setScriptData(parsedData);
          success = true; workingModelName = modelName; 
          console.log(`✅ ¡Éxito con ${modelName}!`);
          break; 
        } catch (err: any) {
          console.warn(`❌ Fallo con ${modelName}:`, err.message);
          lastError = err;
        }
      }
      if (!success) throw lastError || new Error("Todos los modelos fallaron.");
    } catch (err: any) {
      if (err.status === 429 || err.message?.includes('429') || err.message?.includes('quota')) {
        setError('Límite de peticiones alcanzado. Respira hondo y espera un minuto.');
      } else {
        setError(err.message || 'Ha ocurrido un error inesperado al analizar el guión.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Función para texto de prueba
  const analyzeScript = (text: string) => processWithGemini([ promptText + "\nTEXTO:\n" + text ]);
  
  // Función NUEVA para PDFs Reales en Base64
  const analyzePdf = (base64String: string) => {
    processWithGemini([
      { text: promptText },
      { inlineData: { data: base64String, mimeType: "application/pdf" } }
    ]);
  };

  return { analyzeScript, analyzePdf, loading, error, scriptData, setScriptData };
};