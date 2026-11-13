import { getNativePrototypeInfo } from './nativePrototype';

type OutputPlatform = 'ios' | 'android' | 'other';
type BrowserInfo = { userAgent?: string; platform?: string; maxTouchPoints?: number };
export const getSpeechOutputPlatform = (
  browser: BrowserInfo | null = typeof navigator === 'undefined' ? null : navigator,
  installed: 'ios' | 'android' | undefined = getNativePrototypeInfo()?.platform
): OutputPlatform => {
  if (installed) return installed;
  if (/Android/i.test(browser?.userAgent || '')) return 'android';
  return /iPad|iPhone|iPod/i.test(browser?.userAgent || '') ||
    (browser?.platform === 'MacIntel' && (browser.maxTouchPoints || 0) > 1) ? 'ios' : 'other';
};

export const getSpeechOutputHelp = (platform = getSpeechOutputPlatform()) => platform === 'ios'
  ? 'En iPhone, desactiva Silencio (campana tachada) en el Centro de control. La música puede sonar aunque la voz esté silenciada.'
  : platform === 'android'
    ? 'En Android, sube el volumen multimedia. La voz necesita un servicio de texto a voz instalado y una voz en español disponible, también dentro de un emulador.'
    : 'Sube el volumen y comprueba que la salida de audio seleccionada sea la que estás utilizando.';

export const getSpeechOutputErrorMessage = (error: unknown, platform = getSpeechOutputPlatform()) => {
  let detail = '', current = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current !== 'object') break;
    const item = current as { message?: unknown; cause?: unknown };
    if (typeof item.message === 'string' && item.message !== 'calibration-voice-unavailable') detail = item.message.slice(0, 240);
    current = item.cause;
  }
  const timeout = /speech-(start-)?timeout/.test(detail);
  if (platform === 'android') {
    const cause = timeout ? 'El servicio de voz de Android no ha respondido.' : 'Android no ha podido reproducir la voz.';
    return `${cause} Comprueba en Ajustes que haya un motor de texto a voz y una voz en español. Si usas BlueStacks, deben estar instalados dentro del emulador. Después pulsa Probar voz.${detail ? ` Detalle: ${detail}` : ''}`;
  }
  return `No se pudo completar la prueba de voz. Pulsa Probar voz para reiniciarla.${detail ? ` Detalle: ${detail}` : ''}`;
};
