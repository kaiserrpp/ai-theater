import type { NativePlatform } from './protocol';
import type { NativeRecognitionInfo, RecognitionHints } from './recognitionHints';

type StartOptions = {
  lang: string; continuous: boolean; requiresOnDeviceRecognition: boolean; contextualStrings?: string[];
  androidIntentOptions?: { EXTRA_ENABLE_LANGUAGE_DETECTION: boolean; EXTRA_ENABLE_LANGUAGE_SWITCH: 'balanced';
    EXTRA_LANGUAGE_DETECTION_ALLOWED_LANGUAGES: string[]; EXTRA_LANGUAGE_SWITCH_ALLOWED_LANGUAGES: string[] };
};
const canonical = (locale: string) => locale.replace(/_/g, '-');
const findLocale = (locales: string[], requested: string) => locales.find(locale => locale.toLowerCase() === requested.toLowerCase()) ||
  locales.find(locale => locale.split('-')[0].toLowerCase() === requested.split('-')[0].toLowerCase());

// Inspect models once, outside the capture path. No downloads, queries, extra
// decoders or timers are inserted between a validated line and its response.
export const createNativeRecognitionRuntime = (deps: {
  platform: NativePlatform; androidVersion: number; onDevice: boolean;
  getSupportedLocales: () => Promise<{ locales: string[]; installedLocales: string[] }>;
  start: (options: StartOptions) => void;
}) => {
  let installed: string[] | null = null, warming: Promise<void> | null = null, disposed = false;
  let switchRejected = false, englishOfflineRejected = false;
  let current: NativeRecognitionInfo | null = null;
  return {
    warm: () => {
      if (warming) return warming;
      if (deps.platform !== 'android' || !deps.onDevice || deps.androidVersion < 33) return Promise.resolve();
      warming = new Promise<void>(resolve => {
        let done = false;
        const finish = (value?: { installedLocales: string[] }) => {
          if (done) return; done = true; clearTimeout(timer);
          if (!disposed && value) installed = value.installedLocales.filter(locale => typeof locale === 'string').map(canonical);
          resolve();
        };
        const timer = setTimeout(() => finish(), 3000);
        void Promise.resolve().then(deps.getSupportedLocales).then(value => finish(value), () => finish());
      });
      return warming;
    },
    start: (request: { lang: string; continuous: boolean; hints?: RecognitionHints }): NativeRecognitionInfo => {
      const spanish = installed && findLocale(installed, 'es-ES'), english = installed && findLocale(installed, 'en-US');
      const local = installed && findLocale(installed, request.lang);
      const bilingual = Boolean(request.hints?.mixed && deps.platform === 'android' && deps.androidVersion >= 34 &&
        deps.onDevice && spanish && english && !switchRejected);
      const languageIsEnglish = request.lang.toLowerCase().startsWith('en');
      const onDevice = deps.onDevice && (deps.platform !== 'android' || !request.hints || !languageIsEnglish ||
        Boolean(local && !englishOfflineRejected));
      const options: StartOptions = { lang: request.hints && local ? local : request.lang,
        continuous: request.continuous, requiresOnDeviceRecognition: onDevice,
        ...(request.hints?.contextualStrings.length ? { contextualStrings: request.hints.contextualStrings } : {}),
        ...(bilingual ? { androidIntentOptions: { EXTRA_ENABLE_LANGUAGE_DETECTION: true, EXTRA_ENABLE_LANGUAGE_SWITCH: 'balanced' as const,
          EXTRA_LANGUAGE_DETECTION_ALLOWED_LANGUAGES: [spanish!, english!], EXTRA_LANGUAGE_SWITCH_ALLOWED_LANGUAGES: [spanish!, english!] } } : {}),
      };
      current = { lang: options.lang, languageMode: bilingual ? 'switch_requested' : 'single_locale', onDeviceRequested: onDevice,
        contextTermCount: options.contextualStrings?.length || 0,
        localeStatus: deps.platform !== 'android' || installed === null ? 'unknown' : local ? 'installed' : 'not_installed',
        fallbackReason: !request.hints?.mixed || bilingual ? null : deps.platform === 'ios' ? 'ios_single_locale'
          : switchRejected ? 'switch_rejected' : deps.androidVersion < 34 ? 'android_version' : 'models_unavailable' };
      try { deps.start(options); }
      catch (cause) { current = null; throw cause; }
      return { ...current };
    },
    // A rejected language option may retry once through the existing native
    // end/restart lifecycle. It preserves words and never advances a line.
    recoverLanguageError: (code: string) => {
      if (code !== 'language-not-supported' || !current) return false;
      if (current.languageMode === 'switch_requested' && !switchRejected) { switchRejected = true; return true; }
      if (deps.platform === 'android' && current.lang.toLowerCase().startsWith('en') && current.onDeviceRequested && !englishOfflineRejected) {
        englishOfflineRejected = true; return true;
      }
      return false;
    },
    languageDetected: (language: string) => current ? { ...current, detectedLanguage: language.slice(0, 24) } : null,
    stopped: () => { current = null; },
    dispose: () => { disposed = true; current = null; },
  };
};
