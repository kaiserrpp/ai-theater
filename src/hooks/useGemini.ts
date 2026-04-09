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

  const promptText = `Extract script data from this PDF into JSON: {"obra": "string", "personajes": ["string"], "guion": [{"p": "string", "t": "string", "a": "string"}]}. Respond ONLY with valid JSON.`;

  const analyzePdf = async (base64String: string) => {
    setLoading(true);
    setError(null);
    setScriptData(null);

    if (!apiKey) {
      setError("Error: No hay API Key configurada.");
      setLoading(false);
      return;
    }

    // Lista de modelos con nombres exactos que suelen evitar el error 404
    const modelsToTry = [
      "gemini-1.5-flash-latest", // La versión más compatible actualmente
      "gemini-1.5-pro-latest",
      "gemini-pro-vision"        // Fallback clásico para archivos
    ];

    let lastErrorMessage = "";

    for (const modelName of modelsToTry) {
      try {
        console.log(`🤖 Intentando con: ${modelName}`);
        const model = genAI.getGenerativeModel({ model: modelName });

        const result = await model.generateContent([
          { text: promptText },
          { inlineData: { data: base64String, mimeType: "application/pdf" } }
        ]);

        const response = await result.response;
        let text = response.text();
        
        // Limpiamos la respuesta
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        const parsed = JSON.parse(text);
        setScriptData(parsed);
        setLoading(false);
        return; // ÉXITO

      } catch (err: any) {
        lastErrorMessage = err.message;
        console.error(`Fallo en ${modelName}:`, lastErrorMessage);

        // Si es un error de cuota (429), paramos el bucle porque la API Key está bloqueada
        if (lastErrorMessage.includes("429")) {
          setError("Límite de cuota alcanzado. Google nos ha bloqueado temporalmente. Espera 1 minuto.");
          setLoading(false);
          return;
        }
        
        // Si es 404 u otro, el bucle continuará al siguiente modelo...
      }
    }

    setError(`No se pudo conectar con ningún modelo. Último error: ${lastErrorMessage}`);
    setLoading(false);
  };

  return { analyzePdf, loading, error, scriptData, setScriptData };
};