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

  const promptText = `Extrae los datos de este guion en JSON estricto: {"obra": "titulo", "personajes": ["nombre"], "guion": [{"p": "PERSONAJE", "t": "texto", "a": "acotacion"}]}.`;

  const analyzePdf = async (base64String: string) => {
    setLoading(true);
    setError(null);
    setScriptData(null);

    if (!apiKey) {
      setError("Error: API Key no configurada.");
      setLoading(false);
      return;
    }

    try {
      // 1. LLAMADA REAL A LISTMODELS
      // Usamos el cliente de genAI para listar lo que hay disponible para TU cuenta
      console.log("📡 Solicitando lista oficial de modelos a Google...");
      const responseList = await genAI.listModels();
      
      // 2. FILTRADO DINÁMICO
      // Solo nos quedamos con los que permiten generar contenido
      const dynamicCandidates = responseList.models
        .filter(m => m.supportedGenerationMethods.includes('generateContent'))
        .map(m => m.name);

      if (dynamicCandidates.length === 0) {
        throw new Error("Google no devolvió ningún modelo compatible con generateContent.");
      }

      console.log("✅ Modelos reales detectados:", dynamicCandidates);

      let usedModels: string[] = [];
      let lastError = "";

      // 3. BUCLE DE REINTENTOS SOBRE LA LISTA REAL
      for (const modelName of dynamicCandidates) {
        usedModels.push(modelName);
        try {
          console.log(`🤖 Probando modelo oficial: ${modelName}`);
          const model = genAI.getGenerativeModel({ model: modelName });

          const result = await model.generateContent([
            { text: promptText },
            { inlineData: { data: base64String, mimeType: "application/pdf" } }
          ]);

          const response = await result.response;
          const text = response.text();
          
          const jsonStart = text.indexOf('{');
          const jsonEnd = text.lastIndexOf('}') + 1;
          const cleanJson = text.substring(jsonStart, jsonEnd);
          
          setScriptData(JSON.parse(cleanJson));
          setLoading(false);
          return; 

        } catch (err: any) {
          lastError = err.message;
          console.warn(`❌ ${modelName} falló: ${lastError}`);
          
          if (lastError.includes("429")) {
            await wait(2500); // Si es cuota, pausa para respirar
          }
        }
      }

      setError(`Agotados modelos oficiales: ${usedModels.join(', ')}. Último error: ${lastError}`);

    } catch (err: any) {
      setError(`Error al listar o procesar: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return { analyzePdf, loading, error, scriptData, setScriptData };
};