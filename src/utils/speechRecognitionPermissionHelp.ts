export const IOS_SPEECH_RECOGNITION_SETTINGS_PATH =
  'Ajustes → Privacidad y seguridad → Reconocimiento de voz';

type BrowserDevice = {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
};

// The WebKit service permission error identifies iOS authorization, whereas the
// same error code without this message may simply mean an unavailable service.
export const getSpeechRecognitionPermissionHelp = (
  errorCode: string | null,
  errorDetail: string | null,
  device: BrowserDevice
) => {
  if (errorCode !== 'service-not-allowed' ||
      !/speech recognition service permission check has failed/i.test(errorDetail ?? '')) return null;

  const isIOS = /iphone|ipad|ipod/i.test(device.userAgent) ||
    (device.platform === 'MacIntel' && (device.maxTouchPoints ?? 0) > 1);
  if (!isIOS) return null;

  const browserName = /crios/i.test(device.userAgent) ? 'Chrome'
    : /fxios/i.test(device.userAgent) ? 'Firefox'
    : /edgios/i.test(device.userAgent) ? 'Edge'
    : /opios/i.test(device.userAgent) ? 'Opera'
    : /safari/i.test(device.userAgent) ? 'Safari'
    : 'tu navegador';

  return {
    browserName,
    settingsPath: IOS_SPEECH_RECOGNITION_SETTINGS_PATH,
    steps: [
      browserName === 'Safari'
        ? 'Activa Safari con el icono azul de la brújula. Si aparece más de una vez, comprueba esa entrada.'
        : `Activa ${browserName} en la lista.`,
      'Vuelve a esta pestaña y pulsa el botón de comprobación.',
    ],
  };
};
