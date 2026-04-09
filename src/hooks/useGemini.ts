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
  // Iniciamos la lista vacía para obligar a que el descubrimiento funcione
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  // --- DESCUBRIMIENTO DINÁMICO (TU CÓDIGO) ---
  useEffect(() => {
    const fetchModels = async () => {
      if (!API_KEY) {
        console.error("❌ No hay API KEY configurada");
        return;
      }
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();
        
        if (data.models) {
          // Filtramos estrictamente por lo que Google nos diga que puede hacer generateContent
          const utiles = data.models
            .filter((m: any) => m.supportedGenerationMethods.includes('generateContent'))
            .map((m: any) => m.name.replace('models/', ''));
          
          setAvailableModels(utiles);
          console.log("✅ Lista oficial de Google recibida:", utiles);
        } else {
          setError("Google no devolvió modelos. Revisa tu API Key.");
        }
      } catch (err) {
        setError("Error de conexión al listar modelos.");
      }
    };
    fetchModels();
  }, []);

  const analyzePdf = async (base64String: string) => {
    setLoading(true);
    setError(null);

    // Verificación de seguridad: Si no hay modelos, no empezamos
    if (availableModels.length === 0) {
      setError("Todavía no se ha recibido la lista de modelos de Google. Espera 2 segundos.");
      setLoading(false);
      return;
    }

    const promptText = `Extract script data from this PDF into JSON: {"obra": "string", "personajes": ["string"], "guion": [{"p": "string", "t": "string", "a": "string"}]}. Respond ONLY with valid JSON.`;

    let triedModels: string[] = [];
    let lastError = "";

    // BUCLE ESTRICTO SOBRE LA LISTA DE GOOGLE
    for (const modelName of availableModels) {
      triedModels.push(modelName);
      try {
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
        
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}') + 1;
        setScriptData(JSON.parse(text.substring(start, end)));
        setLoading(false);
        return; // Salida por éxito

      } catch (err: any) {
        lastError = err.message;
        console.warn(`❌ Fallo con ${modelName}:`, lastError);
        if (lastError.includes("429")) await wait(3000);
      }
    }

    setError(`Agotados modelos oficiales detectados: ${triedModels.join(', ')}. Último error: ${lastError}`);
    setLoading(false);
  };

  return { analyzePdf, loading, error, scriptData, setScriptData };
};