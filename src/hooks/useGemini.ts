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
  const [statusText, setStatusText] = useState<string>("");

  useEffect(() => {
    const fetchModels = async () => {
      if (!API_KEY) return;
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`);
        const data = await response.json();
        if (response.ok && data.models) {
          const utiles = data.models
            .filter((m: any) => m.supportedGenerationMethods.includes('generateContent'))
            .map((m: any) => m.name.replace('models/', ''));
          setAvailableModels(utiles);
        }
      } catch (err) {}
    };
    fetchModels();
  }, []);

  // Función mejorada: Sube y ESPERA a que el archivo esté ACTIVO
  const uploadAndWaitForActive = async (localUri: string, mimeType: string) => {
    try {
      setStatusText("Paso 1: Empaquetando PDF...");
      const fileResp = await fetch(localUri);
      const blob = await fileResp.blob();

      setStatusText("Paso 2: Enviando PDF a los servidores de Google...");
      const uploadResp = await fetch(
        `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${API_KEY}`,
        {
          method: 'POST',
          headers: {
            'X-Goog-Upload-Protocol': 'raw',
            'X-Goog-Upload-Header-Content-Type': mimeType,
            'Content-Type': mimeType
          },
          body: blob
        }
      );

      const uploadData = await uploadResp.json();
      if (!uploadResp.ok) throw new Error(uploadData.error?.message || "Error al subir");

      const fileUri = uploadData.file.uri;
      const fileName = uploadData.file.name; // Necesitamos el nombre interno (ej: files/abcde) para preguntar cómo va

      setStatusText("Paso 2.5: Google está procesando tu guion. Esperando...");
      
      // BUCLE DE POLLING: Preguntamos cada 3 segundos si ya terminó de procesarlo
      let isReady = false;
      let attempts = 0;
      
      while (!isReady && attempts < 20) { // Máximo de 1 minuto esperando
        await wait(3000);
        attempts++;
        
        setStatusText(`Paso 2.5: Google está procesando tu guion... (Intento ${attempts})`);
        
        const checkResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${API_KEY}`);
        const checkData = await checkResp.json();
        
        if (checkData.state === "ACTIVE") {
          isReady = true;
          setStatusText("¡Guion procesado con éxito por Google!");
        } else if (checkData.state === "FAILED") {
          throw new Error("Google falló al procesar el PDF. Puede que el archivo esté corrupto o protegido.");
        }
      }

      if (!isReady) {
        throw new Error("Tiempo de espera agotado. Google tardó demasiado en procesar el PDF.");
      }

      return fileUri;

    } catch (e: any) {
      throw new Error(`${e.message}`);
    }
  };

  const analyzeScript = async (localUri: string, mimeType: string) => {
    setLoading(true);
    setError(null);
    setScriptData(null);
    setStatusText("Iniciando...");

    if (availableModels.length === 0) {
      setError("Esperando conexión con Google. Revisa tu red.");
      setLoading(false);
      return;
    }

    try {
      // Usamos la nueva función inteligente que no avanza hasta que Google dé luz verde
      const geminiFileUri = await uploadAndWaitForActive(localUri, mimeType);

      const promptText = `Actúa como un extractor de datos de guiones teatrales. 
      REGLAS ESTRICTAS:
      1. NO resumas. Transcribe TODO el texto hablado y las acotaciones.
      2. Extrae todos los personajes únicos en el array "personajes".
      3. Devuelve SOLO JSON válido con este formato: {"obra": "Título exacto", "personajes": ["Persona 1"], "guion": [{"p": "PERSONAJE", "t": "texto", "a": "acotación"}]}`;

      let lastError = "";
      
      for (const modelName of availableModels) {
        try {
          setStatusText(`Paso 3: Analizando con IA (${modelName})...`);
          
          const model = genAI.getGenerativeModel({ 
            model: modelName,
            generationConfig: { responseMimeType: "application/json", maxOutputTokens: 8192 }
          });

          const result = await model.generateContent([
            { text: promptText },
            { fileData: { mimeType, fileUri: geminiFileUri } }
          ]);

          setStatusText("Paso 4: ¡Terminado! Extrayendo datos...");
          const response = await result.response;
          const text = response.text();
          
          const start = text.indexOf('{');
          const end = text.lastIndexOf('}') + 1;
          setScriptData(JSON.parse(text.substring(start, end)));
          
          setLoading(false);
          return; 

        } catch (err: any) {
          lastError = err.message;
          console.warn(`Error en ${modelName}:`, lastError);
          
          // Si da cuota, esperamos, si no, probamos el siguiente rápido
          if (lastError.includes("429")) {
             setStatusText(`Límite de Google alcanzado. Reintentando en 5s...`);
             await wait(5000);
          } else {
             await wait(1000);
          }
        }
      }
      
      setError(`Todos los modelos fallaron. Último error: ${lastError}`);
    } catch (err: any) {
      setError(`Fallo: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Puedes quitar la exportación de analyzeCharactersOnly de tu HomeScreen si quieres, 
  // ya no la necesitamos.
  return { analyzeScript, loading, error, scriptData, setScriptData, statusText };
};