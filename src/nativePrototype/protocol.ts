import type { NativeRecognitionInfo, RecognitionHints } from './recognitionHints';
export const BRIDGE_CHANNEL = 'ai-theatre-native';
export type NativePlatform = 'ios' | 'android';
export type BridgeCommand = {
  channel: typeof BRIDGE_CHANNEL; protocol: 1; type: string; id?: string;
  lang?: string; continuous?: boolean; text?: string; rate?: number; pitch?: number; volume?: number; voice?: string;
  hints?: RecognitionHints;
};
export type BridgeEvent = { type: string; id?: string; text?: string; isFinal?: boolean; error?: string; message?: string; recognitionInfo?: NativeRecognitionInfo;
  level?: number; foreground?: boolean; voices?: { id: string; name: string; lang: string; default: boolean }[] };
export const parseBridgeCommand = (text: string): BridgeCommand | null => {
  if (text.length > 16000) return null;
  try {
    const value = JSON.parse(text);
    if (value?.channel !== BRIDGE_CHANNEL || value.protocol !== 1 ||
      !['hello', 'recognition.start', 'recognition.abort', 'recognition.stop', 'microphone.start', 'microphone.stop', 'speech.start', 'speech.cancel'].includes(value.type)) return null;
    if (value.type !== 'hello' && value.type !== 'speech.cancel' &&
      (typeof value.id !== 'string' || !/^[a-z0-9-]{1,80}$/i.test(value.id))) return null;
    if (value.type === 'recognition.start' && (typeof value.lang !== 'string' || !/^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/i.test(value.lang))) return null;
    if (value.type === 'recognition.start' && value.hints !== undefined) {
      const hints = value.hints;
      if (!hints || typeof hints.mixed !== 'boolean' || !Array.isArray(hints.contextualStrings) || hints.contextualStrings.length > 40 ||
        hints.contextualStrings.some((term: unknown) => typeof term !== 'string' || !term.trim() || term.length > 60 || term.trim().split(/\s+/u).length > 2) ||
        hints.contextualStrings.join('').length > 640) return null;
      value.hints = { mixed: hints.mixed, contextualStrings: hints.contextualStrings.map((term: string) => term.trim()) };
    }
    if (value.type === 'speech.start' && (typeof value.text !== 'string' || value.text.length > 10000)) return null;
    return value;
  } catch { return null; }
};

export const isPrototypeUrl = (url: string, appUrl: string) => {
  try { const target = new URL(url), allowed = new URL(appUrl); return target.protocol === 'https:' && target.origin === allowed.origin; }
  catch { return false; }
};
