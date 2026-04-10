import { GoogleGenerativeAI } from '@google/generative-ai';
import { useEffect, useState } from 'react';

export interface Dialogue { p: string; t: string; a: string; }
export interface ScriptData { obra: string; personajes: string[]; guion: Dialogue[]; }

// Intentamos leer la clave de las variables de entorno de Expo
const API_KEY = process.env.EXPO_PUBLIC_API_KEY || '';
const genAI = new GoogleGenerativeAI(API_KEY);

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const useGemini = () => {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptData, setScriptData] = useState<ScriptData | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  // --- DESCUBRIMIENTO DINÁMICO CON DIAGNÓSTICO ---
  useEffect(() => {
    const fetchModels = async () => {
      // 1. Verificación previa de la clave
      if (!API_KEY) {
        setError("Error Local: La variable EXPO_PUBLIC_API_KEY está vacía. Revisa los Secrets en Vercel.");
        return;
      }

      try {
        console.log("🔍 Intentando conectar con Google API...");
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        
        // Capturamos el JSON de la respuesta sea cual sea
        const data = await response.json();

        if (response.ok && data.models) {
          // Filtrado de modelos que soportan generación de contenido
          const utiles = data.models
            .filter((m: any) => m.supportedGenerationMethods.includes('generateContent'))
            .map((m: any) => m.name.replace('models/', ''));
          
          if (utiles.length > 0) {
            setAvailableModels(utiles);
            console.log("✅ Modelos vivos de Google:", utiles);
          } else {
            setError("Google devolvió una lista, pero ningún modelo es compatible con 'generateContent'.");
          }
        } else {
          // Si Google responde con un error (ej. API Key inválida)
          const googleError = data.error ? `[${data.error.code}] ${data.error.message}` : "Respuesta sin campo 'models'";
          setError(`Error de Google API: ${googleError}`);
        }
      } catch (err: any) {
        // Error de red o excepción de JavaScript
        setError(`Excepción en fetchModels: ${err.message || 'Error desconocido'}`);
      }
    };

    fetchModels();
  }, []);

  const analyzePdf = async (base64String: string) => {
    setLoading(true);
    setError(null);
    setScriptData(null);

    if (availableModels.length === 0) {
      setError("No hay modelos disponibles para procesar el guion. Revisa el error superior.");
      setLoading(false);
      return;
    }

    const promptText = `Extract script data from this PDF into JSON: {"obra": "string", "personajes": ["string"], "guion": [{"p": "string", "t": "string", "a": "string"}]}. Respond ONLY with valid JSON.`;

    let triedModels: string[] = [];
    let lastError = "";

    // Bucle sobre la lista oficial descubierta
    for (const modelName of availableModels) {
      triedModels.push(modelName);
      try {
        console.log(`🚀 Probando modelo: ${modelName}`);
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
        
        // Limpiamos el JSON por si acaso
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}') + 1;
        const cleanJson = text.substring(start, end);
        
        setScriptData(JSON.parse(cleanJson));
        setLoading(false);
        return; 

      } catch (err: any) {
        lastError = err.message || "Error sin mensaje";
        console.warn(`❌ ${modelName} falló:`, lastError);

        if (lastError.includes("429")) {
          await wait(3000); // Pausa si hay saturación
        }
      }
    }

    setError(`Agotados modelos (${triedModels.join(', ')}). Último fallo: ${lastError}`);
    setLoading(false);
  };

  return { analyzePdf, loading, error, scriptData, setScriptData };
};