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

  // --- DESCUBRIMIENTO DINÁMICO POR FETCH (Tu código de éxito) ---
  useEffect(() => {
    const fetchModels = async () => {
      if (!API_KEY) return;
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();
        
        if (data.models) {
          const utiles = data.models
            .filter((m: any) => 
              m.supportedGenerationMethods.includes('generateContent') && 
              (m.name.includes('flash') || m.name.includes('pro'))
            )
            .map((m: any) => m.name.replace('models/', ''));
          
          console.log("✅ Modelos descubiertos dinámicamente:", utiles);
          setAvailableModels(utiles);
        }
      } catch (err) {
        console.error("❌ Error en el descubrimiento:", err);
      }
    };
    fetchModels();
  }, []);

  const promptText = `Extract script data from this PDF into JSON: {"obra": "string", "personajes": ["string"], "guion": [{"p": "string", "t": "string", "a": "string"}]}. Respond ONLY with valid JSON.`;

  const analyzePdf = async (base64String: string) => {
    setLoading(true);
    setError(null);
    setScriptData(null);

    if (!API_KEY) {
      setError("Error: Falta la API Key.");
      setLoading(false);
      return;
    }

    // Usamos los modelos descubiertos o un fallback si el fetch aún no terminó
    const modelsToTry = availableModels.length > 0 
      ? availableModels 
      : ["gemini-1.5-flash", "gemini-1.5-pro"];

    let lastError = "";
    let triedModels: string[] = [];

    for (const modelName of modelsToTry) {
      triedModels.push(modelName);
      try {
        console.log(`🚀 Probando modelo descubierto: ${modelName}`);
        const model = genAI.getGenerativeModel({ 
          model: modelName,
          generationConfig: { responseMimeType: "application/json" }
        });

        const result = await model.generateContent([
          { text: promptText },
          { inlineData: { data: base64String, mimeType: "application/pdf" } }
        ]);

        const response = await result.response;
        const text = response.text();
        
        // Limpiamos el JSON por si la IA se pone charlatana
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}') + 1;
        const cleanJson = text.substring(start, end);
        
        setScriptData(JSON.parse(cleanJson));
        setLoading(false);
        return; // ¡ÉXITO!

      } catch (err: any) {
        lastError = err.message;
        console.warn(`⚠️ Fallo con ${modelName}:`, lastError);

        if (lastError.includes("429")) {
          // Si es cuota, pausa de seguridad antes de quemar el siguiente modelo
          await wait(2500);
        }
      }
    }

    setError(`Agotados modelos: ${triedModels.join(', ')}. Último error: ${lastError}`);
    setLoading(false);
  };

  return { analyzePdf, loading, error, scriptData, setScriptData };
};