export type RecognitionHints = { mixed: boolean; contextualStrings: string[] };
export type NativeRecognitionInfo = {
  lang: string; languageMode: 'single_locale' | 'switch_requested'; onDeviceRequested: boolean;
  contextTermCount: number; localeStatus: 'installed' | 'not_installed' | 'unknown';
  fallbackReason: 'ios_single_locale' | 'models_unavailable' | 'android_version' | 'switch_rejected' | null;
  detectedLanguage?: string;
};

const words = (text: string) => text.normalize('NFKC').match(/[\p{L}][\p{L}'’-]*/gu) || [];
const key = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[’']/g, '');
const english = new Set(('about after all another and back bath be because been before better can cant come could did do dont down english enlgish get getting go got had has have he her here him his home how if im is it its just know like look make mother much my need never news not now out over please really right rican see she should so steal sure surprise take tell thank thanks that thats the their them then there these think this those thought time up us was we were want when what where why will with world would yes youll you your zoo dominican').split(' '));
const spanish = new Set(('a al algo aqui ayer bien buscar café cafe cinco claro como con cosas cuando de del dices diste donde dos el ella en es esa ese eso esta estar este esto estoy extra extras favor gas gritas hablar hay hecho hice hizo hoy iglesia idioma idiomas llamar le lecciones lo los luces mal malo mas me mi mis mucho muy necesito nuevas nuevo noticias no para papá papa palabras pero poco por porque puedo pues que quedar queda queiro quiero rato reconoces rotos se si sin sirva sombra solo son tengo tienes todo traje traido trate tu un una unas uno usted vamos venga voy ya yo').split(' '));

const ambiguous = new Set(['has', 'he', 'come', 'do']);
// Language selection uses the original script, never the fuzzy matching aliases.
// Hints are short vocabulary items from the whole scene, not a replacement reply.
export const buildNativeRecognitionPlan = (text: string, context: { names: string[]; vocabulary: string[] }, fallback: string) => {
  const clean = text.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  const tokens = words(clean).map(key);
  const names = new Set(context.names.flatMap(name => words(name).map(key)));
  const englishCount = tokens.filter(token => !names.has(token) && !ambiguous.has(token) && english.has(token)).length;
  const spanishCount = tokens.filter(token => !names.has(token) && spanish.has(token)).length;
  const namedGreeting = tokens.length > 1 && tokens.length <= 4 && ['ey', 'hey', 'hi', 'hello'].includes(tokens[0]) &&
    tokens.slice(1).every(token => names.has(token));
  const lang = namedGreeting || englishCount > spanishCount ? 'en-US'
    : spanishCount > 0 ? 'es-ES' : fallback;
  const seen = new Set<string>(), contextualStrings: string[] = [];
  let size = 0;
  const priority = context.vocabulary.filter(term => words(term).some(token => tokens.includes(key(token))));
  for (const term of [...context.names, ...priority, ...context.vocabulary]) {
    const value = words(term).slice(0, 2).join(' ').replace(/\benlgish\b/gi, 'English').slice(0, 60);
    const normalized = key(value);
    if (!value || seen.has(normalized) || contextualStrings.length >= 40 || size + value.length > 640) continue;
    contextualStrings.push(value); seen.add(normalized); size += value.length;
  }
  return { lang, hints: { mixed: englishCount > 0 && spanishCount > 0, contextualStrings } satisfies RecognitionHints };
};
