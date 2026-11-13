import { getNativePrototypeInfo, NATIVE_VISIBILITY_EVENT } from './nativePrototype';

export const isPageVisible = () => getNativePrototypeInfo()?.foreground !== false &&
  (typeof document === 'undefined' || document.visibilityState !== 'hidden');

// Focus/blur also fire for permission dialogs. Only an actual page suspension
// should interrupt a rehearsal or its microphone session.
export const observePageVisibility = (onChange: (visible: boolean) => void) => {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  const onVisibilityChange = () => onChange(isPageVisible());
  const onPageHide = () => onChange(false);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onVisibilityChange);
  window.addEventListener(NATIVE_VISIBILITY_EVENT, onVisibilityChange);
  onVisibilityChange();
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onVisibilityChange);
    window.removeEventListener(NATIVE_VISIBILITY_EVENT, onVisibilityChange);
  };
};
