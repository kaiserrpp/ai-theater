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

  const promptText = `
    Analiza este guion teatral y devuélvelo en formato JSON.
    Formato: {"obra": "título", "personajes": ["lista"], "guion": [{"p": "PERSONAJE", "t": "texto", "a": "acotación"}]}
    IMPORTANTE: Responde SOLO con el JSON, sin bloques de código markdown.
  `;

  const processPayload = async (base64String: string) => {
    setLoading(true);
    setError(null);
    setScriptData(null);

    if (!apiKey) {
      setError("Error: No se detecta la API Key en este entorno.");
      setLoading(false);
      return;
    }

    try {
      // Usamos directamente el modelo 1.5-flash que es el que mejor gestiona archivos pesados en la capa gratuita
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const result = await model.generateContent([
        { text: promptText },
        { inlineData: { data: base64String, mimeType: "application/pdf" } }
      ]);

      const response = await result.response;
      let text = response.text();
      
      // Limpiamos posibles etiquetas de markdown que Gemini a veces añade
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      
      setScriptData(JSON.parse(text));
    } catch (err: any) {
      console.error(err);
      // Si el error es por tamaño, intentamos dar un consejo útil
      if (err.message?.includes("fetch") || err.message?.includes("429")) {
        setError("Error de conexión/cuota. El guion es muy pesado para la red móvil. Intenta con un WiFi estable o un guion más corto para probar.");
      } else {
        setError(`Error: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const analyzePdf = (base64String: string) => {
    processPayload(base64String);
  };

  return { analyzePdf, loading, error, scriptData, setScriptData };
};