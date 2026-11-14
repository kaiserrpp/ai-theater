export type NativePrototypeInfo = { protocol: 1; platform: 'ios' | 'android'; appVersion: string; foreground: boolean; nativeLevelInput?: boolean };

export type NativeLevelCapture = { ready: Promise<void>; stop: () => Promise<void> };
export const getNativeLevelInput = () => {
  if (getNativePrototypeInfo()?.nativeLevelInput !== true) return null;
  return (window as Window & { __AI_THEATRE_NATIVE_LEVEL_INPUT__?: {
    open: (onLevel: (level: number) => void, onError: (cause: Error) => void) => NativeLevelCapture;
  } }).__AI_THEATRE_NATIVE_LEVEL_INPUT__ || null;
};

export const waitForNativeLevelInput = async (pending: Promise<void>) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('El grabador nativo no ha confirmado el cambio de captura.')), 8000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
};
export const NATIVE_VISIBILITY_EVENT = 'ai-theatre-native-visibility';
export const NATIVE_READY_EVENT = 'ai-theatre-native-ready';
export const isNativePrototypeShell = () => typeof window !== 'undefined' && typeof navigator !== 'undefined' &&
  /AITheatreNative\//.test(navigator.userAgent) && typeof (window as Window & { ReactNativeWebView?: { postMessage?: unknown } }).ReactNativeWebView?.postMessage === 'function';
export const getNativePrototypeInfo = (): NativePrototypeInfo | null => {
  if (typeof window === 'undefined') return null;
  const value = (window as Window & { __AI_THEATRE_NATIVE_V1__?: NativePrototypeInfo }).__AI_THEATRE_NATIVE_V1__;
  return value?.protocol === 1 && (value.platform === 'ios' || value.platform === 'android') ? value : null;
};
