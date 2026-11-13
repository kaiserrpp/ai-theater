export type NativePrototypeInfo = { protocol: 1; platform: 'ios' | 'android'; appVersion: string; foreground: boolean };
export const NATIVE_VISIBILITY_EVENT = 'ai-theatre-native-visibility';
export const NATIVE_READY_EVENT = 'ai-theatre-native-ready';
export const isNativePrototypeShell = () => typeof window !== 'undefined' && typeof navigator !== 'undefined' &&
  /AITheatreNative\//.test(navigator.userAgent) && typeof (window as Window & { ReactNativeWebView?: { postMessage?: unknown } }).ReactNativeWebView?.postMessage === 'function';
export const getNativePrototypeInfo = (): NativePrototypeInfo | null => {
  if (typeof window === 'undefined') return null;
  const value = (window as Window & { __AI_THEATRE_NATIVE_V1__?: NativePrototypeInfo }).__AI_THEATRE_NATIVE_V1__;
  return value?.protocol === 1 && (value.platform === 'ios' || value.platform === 'android') ? value : null;
};
