import { getNativePrototypeInfo } from './nativePrototype';

type InputContext = 'android-app' | 'ios-app' | 'android-chrome' | 'browser';

export const getMicrophoneInputContext = (
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  installed = getNativePrototypeInfo()?.platform
): InputContext => installed ? `${installed}-app`
  : /Android/i.test(userAgent) && /Chrome\//i.test(userAgent) ? 'android-chrome' : 'browser';

export const getMicrophonePermissionHelp = (context = getMicrophoneInputContext()) => {
  if (context === 'android-app') {
    return 'En la tablet o el teléfono: Ajustes → Aplicaciones → AI-Theatre → Permisos → Micrófono → Permitir mientras se usa la aplicación. Comprueba también que el acceso general al micrófono esté activado.';
  }
  if (context === 'ios-app') return 'En los ajustes del dispositivo, permite el micrófono para AI-Theatre.';
  if (context === 'android-chrome') {
    return 'En Chrome: ⋮ → Configuración → Configuración de sitios → Micrófono. Permite ai-theater.vercel.app. Comprueba también Ajustes de Android → Aplicaciones → Chrome → Permisos → Micrófono → Permitir mientras se usa la aplicación.';
  }
  return 'Abre los permisos del sitio junto a la dirección de la página y permite el micrófono. Comprueba también el permiso del navegador en los ajustes del dispositivo.';
};

export const asMicrophoneInputError = (cause: unknown): Error => {
  if (cause instanceof Error) return cause;
  const value = cause && typeof cause === 'object' ? cause as { name?: unknown; message?: unknown } : null;
  const error = new Error(typeof cause === 'string' ? cause
    : typeof value?.message === 'string' ? value.message : 'microphone-unavailable', { cause });
  if (typeof value?.name === 'string') error.name = value.name;
  return error;
};

export const getMicrophoneInputErrorMessage = (cause: unknown, context = getMicrophoneInputContext()) => {
  const error = asMicrophoneInputError(cause);
  if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
    return `El acceso al micrófono está bloqueado. ${getMicrophonePermissionHelp(context)} Después vuelve a la app y pulsa Reintentar calibración.`;
  }
  if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
    return 'No se encuentra un micrófono disponible. Comprueba que el dispositivo tenga una entrada de audio conectada y vuelve a intentar la calibración.';
  }
  if (error.name === 'NotReadableError' || error.name === 'TrackStartError' || error.name === 'AbortError') {
    return 'El dispositivo no ha podido abrir la entrada de audio. Pulsa Reintentar calibración.';
  }
  if (error.message === 'audio-context-not-running') {
    return 'No se ha activado el procesamiento de audio. Mantén la app visible y pulsa Reintentar calibración.';
  }
  if (error.message === 'microphone-input-unsupported' || error.message === 'audio-context-unavailable') {
    return 'Este entorno no ofrece la captura de audio necesaria para calibrar el micrófono. Prueba abriendo AI-Theatre en Chrome actualizado o desde la app instalada.';
  }
  const detail = [error.name === 'Error' ? '' : error.name, error.message === 'microphone-unavailable' ? '' : error.message]
    .filter(Boolean).join(': ').slice(0, 200);
  return `No se ha podido completar la calibración del micrófono. ${getMicrophonePermissionHelp(context)}${detail ? ` Detalle: ${detail}` : ''}`;
};
