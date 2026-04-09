import { GoogleGenerativeAI } from '@google/generative-ai';
import { useState } from 'react';

export interface Dialogue { p: string; t: string; a: string; }
export interface ScriptData { obra: string; personajes: string[]; guion: Dialogue[]; }

const apiKey = process.env.EXPO_PUBLIC_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const useGemini = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptData, setScriptData] = useState<ScriptData | null>(null);

  const promptText = `Extract script data from this PDF into JSON: {"obra": "string", "personajes": ["string"], "guion": [{"p": "string", "t": "string", "a": "string"}]}. Respond ONLY with valid JSON.`;

  const analyzePdf = async (base64String: string) => {
    setLoading(true);
    setError(null);
    setScriptData(null);

    if (!apiKey) {
      setError("Error: Falta EXPO_PUBLIC_API_KEY en las variables de entorno.");
      setLoading(false);
      return;
    }

    try {
      // 1. DESCUBRIMIENTO REAL
      console.log("🔍 Iniciando listModels()...");
      const modelResponse = await genAI.listModels();
      
      // 2. FILTRADO POR CAPACIDAD
      // Obtenemos todos los modelos que Google dice que tu clave puede usar para generar contenido
      const dynamicModels = modelResponse.models
        .filter(m => m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name);

      if (dynamicModels.length === 0) {
        throw new Error("Google devolvió una lista vacía de modelos para tu API Key.");
      }

      console.log("✅ Modelos vivos detectados:", dynamicModels);

      let lastError = "";
      let triedModels: string[] = [];

      // 3. BUCLE DE EJECUCIÓN
      for (const modelName of dynamicModels) {
        triedModels.push(modelName);
        try {
          console.log(`🚀 Intentando con el modelo oficial: ${modelName}`);
          
          const model = genAI.getGenerativeModel({ 
            model: modelName,
            // Forzamos la configuración de respuesta para evitar que divague
            generationConfig: { responseMimeType: "application/json" }
          });

          const result = await model.generateContent([
            { text: promptText },
            { inlineData: { data: base64String, mimeType: "application/pdf" } }
          ]);

          const response = await result.response;
          const text = response.text();
          
          // Limpieza de JSON
          const start = text.indexOf('{');
          const end = text.lastIndexOf('}') + 1;
          const cleanJson = text.substring(start, end);
          
          setScriptData(JSON.parse(cleanJson));
          setLoading(false);
          return; // Éxito total

        } catch (err: any) {
          lastError = err.message;
          console.warn(`❌ Fallo en ${modelName}:`, lastError);

          // Si el error es de cuota (429), pausamos para no quemar el siguiente modelo al instante
          if (lastError.includes("429")) {
            await wait(3000);
          }
          // Si el error es 404, el bucle sigue inmediatamente al siguiente modelo de la lista real
        }
      }

      // Si terminamos el bucle sin éxito
      setError(`Modelos oficiales intentados: ${triedModels.join(', ')}. Error final: ${lastError}`);

    } catch (err: any) {
      // Este catch atrapa fallos en listModels() o errores de red generales
      setError(`Error en fase de descubrimiento: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return { analyzePdf, loading, error, scriptData, setScriptData };
};