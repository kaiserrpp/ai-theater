import { GoogleGenerativeAI } from '@google/generative-ai';
import { useState } from 'react';

export interface Dialogue { p: string; t: string; a: string; }
export interface ScriptData { obra: string; personajes: string[]; guion: Dialogue[]; }

const apiKey = process.env.EXPO_PUBLIC_API_KEY || '';
const genAI = new GoogleGenerativeAI(apiKey);

// Función de apoyo para esperar entre reintentos
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
      setError("Error: No se encontró la API Key en las variables de entorno.");
      setLoading(false);
      return;
    }

    try {
      // 1. Obtener la lista de modelos disponibles para tu API Key
      const modelList = await genAI.listModels();
      
      // 2. Filtrar modelos candidatos (que soporten generación de contenido)
      const candidates = modelList.models
        .filter(m => m.supportedGenerationMethods.includes('generateContent'))
        // Priorizamos modelos 'flash' por velocidad y cuota más alta
        .sort((a, b) => a.name.includes('flash') ? -1 : 1);

      if (candidates.length === 0) {
        throw new Error("No se encontraron modelos compatibles en tu cuenta de Google AI.");
      }

      let usedModels: string[] = [];
      let lastError = "";

      // 3. Bucle de reintentos inteligente
      for (const modelInfo of candidates) {
        const modelName = modelInfo.name;
        usedModels.push(modelName);

        try {
          console.log(`🤖 Intentando con candidato: ${modelName}`);
          const model = genAI.getGenerativeModel({ model: modelName });

          const result = await model.generateContent([
            { text: promptText },
            { inlineData: { data: base64String, mimeType: "application/pdf" } }
          ]);

          const response = await result.response;
          let text = response.text();
          
          text = text.replace(/```json/g, '').replace(/```/g, '').trim();
          
          const parsed = JSON.parse(text);
          setScriptData(parsed);
          setLoading(false);
          return; // ÉXITO: Salimos de la función

        } catch (err: any) {
          lastError = err.message;
          console.warn(`⚠️ Fallo en ${modelName}: ${lastError}`);

          // Si el error es de cuota (429), esperamos un poco más antes de saltar al siguiente
          if (lastError.includes("429")) {
            console.log("Esperando 3 segundos por límite de cuota...");
            await wait(3000);
          } else {
            // Para otros errores (como el 404 de antes), esperamos menos
            await wait(1000);
          }
        }
      }

      // 4. Si llegamos aquí, es que nada funcionó
      setError(`Fallo tras intentar con: ${usedModels.join(', ')}. Último error: ${lastError}`);

    } catch (err: any) {
      setError(`Error en el proceso de descubrimiento: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return { analyzePdf, loading, error, scriptData, setScriptData };
};