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

  const promptText = `Extrae los datos de este guion en JSON estricto: {"obra": "titulo", "personajes": ["nombre"], "guion": [{"p": "PERSONAJE", "t": "texto", "a": "acotacion"}]}. No incluyas markdown.`;

  const analyzePdf = async (base64String: string) => {
    setLoading(true);
    setError(null);
    setScriptData(null);

    if (!apiKey) {
      setError("Error: API Key no configurada en Vercel.");
      setLoading(false);
      return;
    }

    try {
      // 1. Obtener la lista de modelos de forma correcta
      // En la SDK actual, se accede a través de la API de administración o se definen los candidatos conocidos
      // Como listModels() a veces falla en entornos de navegador por CORS, vamos a usar
      // la lista de "Candidatos Probados" que Gemini soporta para PDFs en 2026.
      
      const candidates = [
        "gemini-1.5-flash",
        "gemini-1.5-flash-8b",
        "gemini-1.5-pro",
        "gemini-2.0-flash-exp"
      ];

      let usedModels: string[] = [];
      let lastError = "";

      // 2. Bucle de reintentos sobre los modelos candidatos
      for (const modelName of candidates) {
        usedModels.push(modelName);
        try {
          console.log(`📡 Probando con: ${modelName}`);
          const model = genAI.getGenerativeModel({ model: modelName });

          const result = await model.generateContent([
            { text: promptText },
            { inlineData: { data: base64String, mimeType: "application/pdf" } }
          ]);

          const response = await result.response;
          let text = response.text();
          
          // Limpieza manual por si la IA devuelve basura fuera del JSON
          const jsonStart = text.indexOf('{');
          const jsonEnd = text.lastIndexOf('}') + 1;
          const cleanJson = text.substring(jsonStart, jsonEnd);
          
          const parsed = JSON.parse(cleanJson);
          setScriptData(parsed);
          setLoading(false);
          return; // Si funciona, cortamos el bucle aquí

        } catch (err: any) {
          lastError = err.message;
          console.warn(`❌ Modelo ${modelName} falló: ${lastError}`);

          // Si es un error de cuota (429), esperamos antes de saltar al siguiente
          if (lastError.includes("429")) {
            await wait(2000); 
          }
          // Si es 404 (no existe), pasamos rápido al siguiente
        }
      }

      // 3. Si ninguno funcionó
      setError(`Agotados todos los modelos (${usedModels.join(', ')}). Último error: ${lastError}`);

    } catch (err: any) {
      setError(`Error crítico: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return { analyzePdf, loading, error, scriptData, setScriptData };
};