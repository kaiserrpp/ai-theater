const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const { setImmediate: settle } = require('node:timers/promises');
const previous = require.extensions['.ts'];
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { buildNativeRecognitionPlan } = require('../src/nativePrototype/recognitionHints.ts');
const { createNativeRecognitionRuntime } = require('../src/nativePrototype/recognitionRuntime.ts');
const { createNativePrototypeController } = require('../src/nativePrototype/controller.ts');
const { nativeBridgeBootstrap } = require('../src/nativePrototype/bridgeBootstrap.ts');
const { parseBridgeCommand } = require('../src/nativePrototype/protocol.ts');
const { createSpeechRecognitionSession } = require('../src/utils/speechRecognitionSession.ts');
const { buildScriptRecognitionContext } = require('../src/utils/scriptRecognitionContext.ts');
const { inferSpeechRecognitionLanguage, scoreLineMatch, getAutomaticLineAdvanceDelay } = require('../src/utils/lineMatching.ts');
if (previous) require.extensions['.ts'] = previous; else delete require.extensions['.ts'];
const context = buildScriptRecognitionContext([
  { p: 'BENNY', t: 'Ey, sonny' }, { p: 'BENNY', t: 'Tengo noticias. My Enlgish is getting much better.' },
  { p: 'NINA', t: 'Really? Sure (se rie)' },
], ['SONNY', 'NINA', 'BENNY']);
const plan = text => buildNativeRecognitionPlan(text, context, inferSpeechRecognitionLanguage(text));
const flush = async () => { await settle(); await settle(); };
const fixture = (extra = {}) => {
  const starts = []; let queries = 0;
  const runtime = createNativeRecognitionRuntime({ platform: 'android', androidVersion: 35, onDevice: true,
    getSupportedLocales: async () => { queries++; return { locales: ['es-ES', 'en-US'], installedLocales: ['es-ES', 'en-US'] }; },
    ...extra, start: options => starts.push(options) });
  return { runtime, starts, queries: () => queries, start: text => runtime.start({ ...plan(text), continuous: true }) };
};

test('the reported English prompts select English from script vocabulary without changing line matching', () => {
  for (const text of ['Ey, sonny', 'Hey, Sonny!', 'Really?', 'Sure (se rie)', 'Tengo noticias. My Enlgish is getting much better.']) {
    assert.equal(inferSpeechRecognitionLanguage(text), 'es-ES', 'the matching module remains unchanged');
    assert.equal(plan(text).lang, 'en-US', text);
  }
  assert.equal(plan('Tengo noticias. My Enlgish is getting much better.').hints.mixed, true);
  assert.equal(plan('Really?').hints.mixed, false);
  assert.equal(plan('Sure (se rie)').hints.mixed, false);
  for (const text of ['Pues sí que has traído nuevas palabras', 'No, no, quiero estar un rato solo, con mis cristales rotos',
    'No, pero espera', 'Son los primeros cinco dólares que papa hizo aquí']) assert.equal(plan(text).lang, 'es-ES', text);
  const dialect = plan('Ya lo sé pero hay dos idiomas distintos: Dominican English y Puerto riquean English… necesito unas lecciones extras');
  assert.equal(dialect.lang, 'es-ES'); assert.equal(dialect.hints.mixed, true);
  assert.equal(plan('The world will know').lang, 'en-US');
  for (const text of ['Pues sí que has traído nuevas palabras', 'He visto la escena', 'Come conmigo']) {
    assert.equal(plan(text).lang, 'es-ES'); assert.equal(plan(text).hints.mixed, false, text);
  }
  for (const heard of ['', 'tengo noticias']) {
    const expected = 'Tengo noticias. My Enlgish is getting much better.';
    assert.equal(getAutomaticLineAdvanceDelay(expected, heard, heard, scoreLineMatch(expected, heard)), null);
  }
});

test('context contains bounded names and vocabulary, removes stage directions and never transmits the expected reply', () => {
  const result = plan('Tengo noticias. My Enlgish is getting much better.');
  assert(result.hints.contextualStrings.includes('Sonny'));
  assert(result.hints.contextualStrings.includes('English'));
  assert(!result.hints.contextualStrings.some(term => /se rie|Enlgish|Tengo noticias\. My/i.test(term)));
  const large = buildNativeRecognitionPlan('Really?', { names: Array.from({length:100}, (_,i)=>`Name${i}`), vocabulary: ['x'.repeat(100), ...Array(100).fill('Really')] }, 'es-ES');
  assert(large.hints.contextualStrings.length <= 40);
  assert(large.hints.contextualStrings.join('').length <= 640);
  assert(large.hints.contextualStrings.every(term => term.length <= 60 && term.split(' ').length <= 2));
});

test('Android requests bilingual capture only with both installed models and adds no per-line async preparation', async () => {
  const f = fixture(); await f.runtime.warm(); await f.runtime.warm(); assert.equal(f.queries(), 1);
  const info = f.start('Tengo noticias. My English is getting much better.');
  assert.equal(info.languageMode, 'switch_requested'); assert.equal(info.lang, 'en-US');
  assert.equal(info.onDeviceRequested, true); assert.equal(info.contextTermCount, plan('Really?').hints.contextualStrings.length);
  const extras = f.starts[0].androidIntentOptions;
  assert.equal(extras.EXTRA_ENABLE_LANGUAGE_SWITCH, 'balanced', 'Android expects a string sensitivity, not a boolean');
  assert.deepEqual(extras.EXTRA_LANGUAGE_SWITCH_ALLOWED_LANGUAGES, ['es-ES', 'en-US']);
  f.start('Really?'); f.start('No, pero espera'); assert.equal(f.queries(), 1);
  assert.equal(f.starts[1].lang, 'en-US'); assert.equal(f.starts[1].androidIntentOptions, undefined);
  assert.equal(f.starts[2].lang, 'es-ES'); assert.equal(f.starts[2].requiresOnDeviceRecognition, true);
});

test('a missing English model keeps Spanish fast and allows the system English service without forcing a missing local model', async () => {
  const f = fixture({ getSupportedLocales: async () => ({locales:['es-ES','en-US'],installedLocales:['es-ES']}) });
  await f.runtime.warm();
  const info = f.start('Tengo noticias. My English is getting much better.');
  assert.equal(info.languageMode, 'single_locale'); assert.equal(info.fallbackReason, 'models_unavailable');
  assert.equal(info.localeStatus, 'not_installed'); assert.equal(f.starts[0].requiresOnDeviceRecognition, false);
  f.start('Pues sí que has traído nuevas palabras'); assert.equal(f.starts[1].requiresOnDeviceRecognition, true);
  assert.equal(f.starts[1].lang, 'es-ES');
});

test('Apple receives the shared language and context with one locale, without Android-only options or model queries', async () => {
  const f = fixture({platform:'ios'}); await f.runtime.warm();
  const info = f.start('Tengo noticias. My English is getting much better.');
  assert.equal(f.queries(), 0); assert.equal(info.languageMode, 'single_locale');
  assert.equal(info.fallbackReason, 'ios_single_locale'); assert.equal(info.localeStatus, 'unknown');
  assert.equal(f.starts[0].lang, 'en-US'); assert(f.starts[0].contextualStrings.includes('Sonny'));
  assert.equal(f.starts[0].androidIntentOptions, undefined);
  assert.equal(f.start('Sure (se rie)').fallbackReason, null);
  f.start('No pero espera'); assert.equal(f.starts[2].lang, 'es-ES');
});

test('older Android and unknown or failed model queries cannot claim bilingual support or stall an actor capture', async t => {
  const older = fixture({androidVersion:33}); await older.runtime.warm();
  assert.equal(older.start('Tengo noticias. My English is getting much better.').fallbackReason, 'android_version');
  const failed = fixture({getSupportedLocales:async()=>{throw Error('service unavailable')}}); await failed.runtime.warm();
  assert.equal(failed.start('Really?').localeStatus, 'unknown');
  t.mock.timers.enable({apis:['setTimeout']}); let resolve;
  const delayed = fixture({getSupportedLocales:()=>new Promise(done=>{resolve=done})});
  const warming = delayed.runtime.warm(); await flush();
  assert.equal(delayed.start('Really?').onDeviceRequested, false, 'capture can start before a model query resolves');
  t.mock.timers.tick(3000); await warming;
  resolve({locales:['es-ES','en-US'],installedLocales:['es-ES','en-US']}); await flush();
  assert.equal(delayed.start('Tengo noticias. My English is getting much better.').languageMode, 'single_locale', 'late model result is retired');
});

test('a rejected language switch falls back once and an unrelated microphone error never triggers a language retry', async () => {
  const f = fixture(); await f.runtime.warm(); f.start('Tengo noticias. My English is getting much better.');
  assert.equal(f.runtime.recoverLanguageError('audio-capture'), false);
  assert.equal(f.runtime.recoverLanguageError('language-not-supported'), true);
  const fallback = f.start('Tengo noticias. My English is getting much better.');
  assert.equal(fallback.languageMode, 'single_locale'); assert.equal(fallback.fallbackReason, 'switch_rejected');
  assert.equal(f.runtime.recoverLanguageError('language-not-supported'), true);
  assert.equal(f.start('Really?').onDeviceRequested, false);
  assert.equal(f.runtime.recoverLanguageError('language-not-supported'), false, 'no infinite retry');
  f.runtime.stopped(); assert.equal(f.runtime.languageDetected('en-US'), null);
});

test('the real bridge carries hints and configuration, preserves raw words through pauses, and waits for actual close on language changes', async t => {
  const starts = [], queries = [], speech = []; let active = false, hints = plan('Really?').hints;
  const window = Object.assign(new EventTarget(), { ReactNativeWebView:{postMessage: text => controller.handle(parseBridgeCommand(text))} });
  const runtime = createNativeRecognitionRuntime({platform:'ios',androidVersion:0,onDevice:true,
    getSupportedLocales:async()=>{queries.push('query');return{locales:[],installedLocales:[]}},
    start: options=>{active=true;starts.push(options);controller.recognitionEvent('start');controller.recognitionEvent('audiostart');} });
  const controller = createNativePrototypeController({emit:event=>window.__AI_THEATRE_NATIVE_RECEIVE__?.(event),
    requestPermission:async()=>true,isRecognitionAvailable:()=>true,startRecognition:runtime.start,
    abortRecognition:()=>runtime.stopped(),stopRecognition:()=>runtime.stopped(),voices:async()=>[],stopSpeech:async()=>{},
    speak:(text,options)=>{assert.equal(active,false);speech.push(text);options.onStart();options.onDone();}});
  vm.runInNewContext(nativeBridgeBootstrap({platform:'ios',appVersion:'2026.11.232',recognitionHints:true}),{window,Map,Event,JSON});
  const session = createSpeechRecognitionSession(window.SpeechRecognition,()=>{}, {controlledEnd:true,getNativeHints:()=>hints});
  t.after(()=>{session.dispose();controller.dispose();runtime.dispose()});
  const end=()=>{active=false;controller.recognitionEvent('audioend');controller.recognitionEvent('end')};
  session.configure({enabled:true,lang:'en-US',lineKey:'english'}); await flush();
  assert.equal(session.getSnapshot().nativeRecognition.lang, 'en-US'); assert.equal(queries.length,0);
  controller.recognitionEvent('result',{text:'Really',isFinal:false});
  session.stop(); end(); assert.equal(session.getSnapshot().transcript,'Really');
  session.activate({lang:'en-US',lineKey:'english',preserveTranscript:true}); await flush();
  controller.recognitionEvent('result',{text:'Sonny',isFinal:true});
  assert.equal(session.getSnapshot().transcript,'Really Sonny'); assert.equal(speech.length,0);
  hints=undefined;session.configure({enabled:true,lang:'es-ES',lineKey:'scene-command'}); await flush();
  assert.equal(starts.length,2,'language change waits for old capture end'); assert.equal(session.getSnapshot().nativeRecognition,null);
  end(); await new Promise(resolve=>setTimeout(resolve,5)); await flush();
  assert.equal(starts[2].lang,'es-ES'); assert.equal(starts[2].contextualStrings,undefined,'commands and calibration have no script hints');
  controller.recognitionEvent('result',{text:'no adelante',isFinal:true});
  assert.equal(session.getSnapshot().transcript,'no adelante','no expected words are injected into transcription');
});

test('the versioned protocol rejects oversized or sentence hints before native APIs receive them', () => {
  const base={channel:'ai-theatre-native',protocol:1,type:'recognition.start',id:'r-1',lang:'en-US'};
  for(const hints of [{mixed:true,contextualStrings:['a sentence with many words']},{mixed:true,contextualStrings:['x'.repeat(61)]},
    {mixed:true,contextualStrings:[null]},{mixed:true,contextualStrings:Array(41).fill('Sonny')},{mixed:'yes',contextualStrings:[]}]) {
    assert.equal(parseBridgeCommand(JSON.stringify({...base,hints})),null);
  }
  assert(parseBridgeCommand(JSON.stringify({...base,hints:plan('Really?').hints})));
  assert(parseBridgeCommand(JSON.stringify(base)),'old clients remain compatible');
});
