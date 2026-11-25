const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const { setImmediate: settle } = require('node:timers/promises');
const previous = require.extensions['.ts'];
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { createNativePrototypeController } = require('../src/nativePrototype/controller.ts');
const { nativeBridgeBootstrap } = require('../src/nativePrototype/bridgeBootstrap.ts');
const { parseBridgeCommand, isPrototypeUrl } = require('../src/nativePrototype/protocol.ts');
const { createSpeechRecognitionSession } = require('../src/utils/speechRecognitionSession.ts');
const { isHomeRehearsalCommand } = require('../src/utils/voiceAdvance.ts');
const { isSceneAdvanceCommand } = require('../src/utils/rehearsalSceneTransition.ts');
if (previous) require.extensions['.ts'] = previous; else delete require.extensions['.ts'];
const command = (type, id, extra = {}) => ({ channel: 'ai-theatre-native', protocol: 1, type, id, ...extra });
const deferred = () => { let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}; };
const flush = async () => { await settle();await settle(); };
const sceneCommandReady = ({ lastUtterance }) => Boolean(lastUtterance?.isFinal && isSceneAdvanceCommand(lastUtterance.text));

const fixture = (t, extra = {}) => {
  const events=[], starts=[], spoken=[], calls=[];
  let active=false, speech=false;
  const window=Object.assign(new EventTarget(), { ReactNativeWebView: { postMessage: text => controller.handle(parseBridgeCommand(text)) } });
  const controller=createNativePrototypeController({
    emit:event=>{events.push(event);window.__AI_THEATRE_NATIVE_RECEIVE__?.(event)},
    requestPermission:extra.requestPermission||(async()=>true),isRecognitionAvailable:()=>true,
    startRecognition:options=>{assert.equal(speech,false);active=true;starts.push(options);controller.recognitionEvent('start');controller.recognitionEvent('audiostart')},
    abortRecognition:()=>calls.push('abort'),stopRecognition:()=>calls.push('stop'),
    speak:(text,options)=>{assert.equal(active,false,'native playback cannot overlap capture');extra.onSpeak?.();speech=true;spoken.push({text,options});options.onStart()},
    stopSpeech:async()=>{speech=false;calls.push('stopSpeech')},voices:async()=>[],
    iosAudioSession: extra.iosAudioSession,
  });
  vm.runInNewContext(nativeBridgeBootstrap({platform:'ios',appVersion:'2026.11.224'}),{window,Event,Map,JSON});
  const snapshots=[];
  const session=createSpeechRecognitionSession(window.SpeechRecognition,s=>snapshots.push(s),{
    controlledEnd:true,prepareRestart:()=>{throw Error('Native recognition must not require the Safari speech cue')},
    recoverNativeInput: extra.recoverNativeInput, getCommand: extra.getCommand,
  });
  window.addEventListener('ai-theatre-native-visibility',()=>session.setPageVisible(window.__AI_THEATRE_NATIVE_V1__.foreground));
  t.after(()=>{session.dispose();controller.dispose()});
  return {controller,window,session,events,starts,spoken,calls,snapshots,
    open:async()=>{session.configure({enabled:true,lang:'es-ES',lineKey:'actor'});await flush()},
    words:(text,isFinal=false)=>controller.recognitionEvent('result',{text,isFinal}),
    end:()=>{active=false;controller.recognitionEvent('audioend');controller.recognitionEvent('end')},
  };
};

test('only the versioned native protocol and the configured HTTPS origin can access the bridge',()=>{
  assert(parseBridgeCommand(JSON.stringify(command('recognition.start','r-1',{lang:'es-ES'}))));
  for(const value of [command('unknown','r-1'),{...command('recognition.start','r-1',{lang:'es'}),protocol:2},
    command('recognition.start','r-1',{lang:'evil/script'}),command('speech.start','s-1',{text:'x'.repeat(10001)})]){
    assert.equal(parseBridgeCommand(JSON.stringify(value)),null);
  }
  assert(isPrototypeUrl('https://ai-theater.vercel.app/?share=work','https://ai-theater.vercel.app/'));
  for(const url of ['https://ai-theater.vercel.app.evil.test/','http://ai-theater.vercel.app/','file:///test']){
    assert.equal(isPrototypeUrl(url,'https://ai-theater.vercel.app/'),false);
  }
});

test('native capture closes by explicit command but playback waits for the actual input-end acknowledgement',async t=>{
  const f=fixture(t);await f.open();f.words('Ey');
  assert.equal(f.window.SpeechRecognition.controlledInputEnd,true);
  f.session.stop();let ended=false;
  const waiting=f.session.waitForInputEnd().then(value=>{ended=value});await flush();
  assert.deepEqual(f.calls,['abort']);assert.equal(ended,false);
  f.end();await waiting;assert.equal(ended,true);
  const utterance=new f.window.SpeechSynthesisUtterance('Respuesta.');f.window.speechSynthesis.speak(utterance);await flush();
  assert.equal(f.spoken.length,1);assert.equal(f.spoken[0].text,'Respuesta.');
});

test('iOS restores the ordinary output mode after native input ends and before the response plays', async t => {
  const inputConfiguration = { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth'], mode: 'measurement' };
  let settings = inputConfiguration;
  const changes = [];
  const voiceModes = [];
  const f = fixture(t, {
    iosAudioSession: {
      getAudioSessionCategoryAndOptionsIOS: () => settings,
      setCategoryIOS: next => { settings = next; changes.push(next); },
    },
    onSpeak: () => voiceModes.push(settings.mode),
  });
  await f.open();
  f.session.stop();
  const speak = () => f.window.speechSynthesis.speak(new f.window.SpeechSynthesisUtterance('Respuesta.'));
  speak();
  await flush();
  assert.deepEqual(changes, []);
  assert.deepEqual(voiceModes, []);

  f.end();
  await flush();
  assert.deepEqual(changes, [{ ...inputConfiguration, mode: 'default' }]);
  assert.deepEqual(voiceModes, ['default']);
  speak();
  await flush();
  assert.deepEqual(voiceModes, ['default', 'default']);
  assert.equal(changes.length, 1);
});

test('a rejected iOS output mode change still lets the system voice play', async t => {
  let changeAttempts = 0;
  const f = fixture(t, {
    iosAudioSession: {
      getAudioSessionCategoryAndOptionsIOS: () => ({ category: 'playAndRecord', categoryOptions: ['defaultToSpeaker'], mode: 'measurement' }),
      setCategoryIOS: () => { changeAttempts++; throw new Error('Audio route changed'); },
    },
  });
  f.window.speechSynthesis.speak(new f.window.SpeechSynthesisUtterance('Respuesta.'));
  await flush();
  assert.equal(changeAttempts, 1);
  assert.equal(f.spoken.length, 1);
});

test('iPhone commands settle a whole utterance without accepting a provisional command prefix',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(t);
  f.session.configure({enabled:true,lang:'es-ES',lineKey:'home:ensayo',continuous:false});await flush();
  assert.equal(f.starts[0].continuous,false,'iOS must be allowed to finish each command utterance');
  f.words('ensayo');
  assert.equal(f.session.getSnapshot().lastUtterance.isFinal,false);
  f.words('ensayo mañana');f.end();
  assert.equal(isHomeRehearsalCommand(f.session.getSnapshot().lastUtterance.text),false);
  t.mock.timers.tick(0);await flush();
  assert.equal(f.starts[1].continuous,false);
  f.words('¡Ensayo!');f.end();
  const home=f.session.getSnapshot().lastUtterance;
  assert.equal(home.isFinal,true);assert.equal(isHomeRehearsalCommand(home.text),true);
  f.session.stop();assert.equal(await f.session.waitForEnd(),true);
  f.session.configure({enabled:true,lang:'es-ES',lineKey:'scene:1',continuous:false});await flush();
  f.words('adelante');
  assert.equal(sceneCommandReady(f.session.getSnapshot()),false);
  f.words('adelante con la prueba');f.end();
  assert.equal(sceneCommandReady(f.session.getSnapshot()),false);
  f.session.resetTranscript();t.mock.timers.tick(0);await flush();
  f.words('¡Adelante!');f.end();
  assert.equal(sceneCommandReady(f.session.getSnapshot()),true);
  f.session.stop();t.mock.timers.tick(10000);await flush();
  assert.equal(f.starts.length,4,'a consumed command must not reopen capture');
});

test('a settled iPhone command is consumed once even when the SDK immediately sends an empty final result', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  let starts = 0;
  const f = fixture(t, { getCommand: key => key === 'home:ensayo' ? {
    accepts: isHomeRehearsalCommand, onRecognized: () => starts++,
  } : undefined });
  f.session.configure({ enabled: true, lang: 'es-ES', lineKey: 'home:ensayo', continuous: false });
  await flush();
  f.words('ensayo');
  f.words('ensayo mañana');
  f.end();
  t.mock.timers.tick(0);
  await flush();
  assert.equal(starts, 0);
  f.words('¡Ensayo!', true);
  f.words('', true);
  f.end();
  t.mock.timers.tick(2500);
  await flush();
  assert.equal(starts, 1);
  assert.equal(f.starts.length, 2, 'the recognised command must not open a new microphone');
});

test('rapid no-speech ends back off and a productive session listens through a long pause', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const f = fixture(t, { recoverNativeInput: true });
  await f.open();
  for (const delay of [250, 500, 1000, 2000, 2000]) {
    const count = f.starts.length;
    f.controller.recognitionEvent('error', { error: 'no-speech' });
    f.end();
    t.mock.timers.tick(delay - 1);
    await flush();
    assert.equal(f.starts.length, count);
    t.mock.timers.tick(1);
    await flush();
    assert.equal(f.starts.length, count + 1);
  }
  assert.equal(f.session.getDiagnostics().noSpeechCount, 5);
  f.words('No quiero estar solo con');
  t.mock.timers.tick(20000);
  await flush();
  assert.equal(f.starts.length, 6);
  assert.deepEqual(f.calls, []);
  assert.equal(f.session.getSnapshot().interimTranscript, 'No quiero estar solo con');
  f.words('No quiero estar solo con mis cristales rotos');
  assert.match(f.session.getSnapshot().transcript, /cristales rotos$/);
});

test('input that stays open without any text gets one automatic restart after confirmed closure', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const f = fixture(t, { recoverNativeInput: true });
  await f.open();
  t.mock.timers.tick(15000);
  assert.deepEqual(f.calls, ['abort']);
  assert.equal(f.session.getSnapshot().status, 'finishing');
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(f.starts.length, 1);
  f.end();
  t.mock.timers.tick(500);
  await flush();
  assert.equal(f.starts.length, 2);
  t.mock.timers.tick(30000);
  assert.deepEqual(f.calls, ['abort']);
  f.words('Ya está la réplica', true);
  assert.equal(f.session.getSnapshot().transcript, 'Ya está la réplica');
  assert.equal(f.session.getDiagnostics().retryCount, 1);
});

test('a foreground iPhone interruption auto-recovers once and cannot promote a retired command', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  let advances = 0;
  const f = fixture(t, { recoverNativeInput: true, getCommand: () => ({
    accepts: isSceneAdvanceCommand, onRecognized: () => advances++,
  }) });
  f.session.configure({ enabled: true, lang: 'es-ES', lineKey: 'scene:2', continuous: false });
  await flush();
  f.words('adelante');
  f.controller.recognitionEvent('error', { error: 'interrupted' });
  f.words('adelante', true);
  f.end();
  t.mock.timers.tick(500);
  await flush();
  assert.equal(f.starts.length, 2);
  assert.equal(advances, 0);
  f.controller.recognitionEvent('error', { error: 'interrupted' });
  f.end();
  t.mock.timers.tick(15000);
  await flush();
  assert.equal(f.starts.length, 2);
  assert.equal(f.session.getSnapshot().errorCode, 'interrupted');
});

test('switching between a command and a continuous actor turn waits for native closure and keeps long pauses',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(t);
  f.session.configure({enabled:true,lang:'es-ES',lineKey:'scene:1',continuous:false});await flush();
  f.words('adelante',true);
  f.session.configure({enabled:true,lang:'es-ES',lineKey:'actor:1'});await flush();
  assert.equal(f.starts.length,1);assert.deepEqual(f.calls,['abort']);
  f.words('OLD COMMAND',true);f.end();t.mock.timers.tick(0);await flush();
  assert.equal(f.starts.length,2);assert.equal(f.starts[1].continuous,true);
  f.words('Primera parte');t.mock.timers.tick(14000);await flush();
  assert.equal(f.starts.length,2);assert.equal(f.session.getSnapshot().transcript,'Primera parte');
  assert.equal(f.session.getSnapshot().lastUtterance.isFinal,false);
  f.words('Primera parte y final',true);
  f.session.configure({enabled:true,lang:'es-ES',lineKey:'scene:2',continuous:false});await flush();
  assert.equal(f.starts.length,2);f.end();t.mock.timers.tick(0);await flush();
  assert.equal(f.starts.length,3);assert.equal(f.starts[2].continuous,false);
  f.words('no adelante');f.end();
  assert.equal(sceneCommandReady(f.session.getSnapshot()),false);
});

test('a settled native command survives automatic rearming until a new utterance or explicit reset',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(t);
  f.session.configure({enabled:true,lang:'es-ES',lineKey:'home:ensayo',continuous:false});await flush();
  f.words('ensayo');f.end();t.mock.timers.tick(0);await flush();
  assert.equal(f.starts.length,2);
  assert.deepEqual(f.session.getSnapshot().lastUtterance,{text:'ensayo',isFinal:true,lineKey:'home:ensayo'});
  f.words('no ensayo');
  assert.equal(f.session.getSnapshot().lastUtterance.text,'no ensayo');
  assert.equal(f.session.getSnapshot().lastUtterance.isFinal,false);
  f.session.restart();f.end();t.mock.timers.tick(0);await flush();
  assert.equal(f.session.getSnapshot().lastUtterance,null);
  f.words('ensayo');f.end();t.mock.timers.tick(0);await flush();
  f.session.configure({enabled:false,lang:'es-ES',lineKey:null});
  assert.equal(f.session.getSnapshot().lastUtterance,null);
});

test('a native segmented result replaces the interim segment and accumulates completed words exactly once',async t=>{
  const f=fixture(t);await f.open();
  f.words('Primera parte',true);f.words('segunda');f.words('segunda parte',true);
  assert.equal(f.session.getSnapshot().transcript,'Primera parte segunda parte');
  assert.equal(f.session.getSnapshot().finalTranscript,'Primera parte segunda parte');
});

test('a manual native pause and resume preserve incomplete words without accepting silence as a completed line',async t=>{
  const f=fixture(t);await f.open();f.words('Ey');f.session.stop();f.end();
  assert.equal(f.session.getSnapshot().transcript,'Ey');
  f.session.activate({lang:'es-ES',lineKey:'actor',preserveTranscript:true});await flush();f.words('Sonny');
  assert.equal(f.session.getSnapshot().transcript,'Ey Sonny');assert.equal(f.spoken.length,0);
});

test('background recovery preserves words and ignores the retired input, while an intentional pause remains paused',async t=>{
  const f=fixture(t);await f.open();f.words('primera');
  f.controller.setForeground(false);f.end();assert.equal(f.session.getSnapshot().transcript,'primera');
  f.controller.recognitionEvent('result',{text:'OLD LATE RESULT',isFinal:true});
  f.controller.setForeground(true);await flush();f.words('segunda');
  assert.equal(f.session.getSnapshot().transcript,'primera segunda');
  f.session.stop();f.end();const count=f.starts.length;
  f.controller.setForeground(false);f.controller.setForeground(true);await flush();
  assert.equal(f.starts.length,count);assert.equal(f.spoken.length,0);
});

test('an iPhone audio interruption keeps the page active and lets the actor retry after native capture closes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  await f.open();
  f.words('Primera parte');
  f.controller.recognitionEvent('error', { error: 'interrupted', message: 'Audio session was interrupted' });
  f.words('Resultado tardío', true);

  assert.equal(f.window.__AI_THEATRE_NATIVE_V1__.foreground, true);
  assert.equal(f.session.getSnapshot().errorCode, 'interrupted');
  assert.equal(f.session.getSnapshot().isAudioActive, false);
  assert.equal(f.session.getSnapshot().lastUtterance, null);
  assert.equal(f.session.getSnapshot().transcript, '');
  assert.deepEqual(f.calls, [], 'iOS is already closing the interrupted capture');
  assert.deepEqual(f.session.getDiagnostics().errors.map(error => error.code), ['interrupted']);

  f.session.restart();
  t.mock.timers.tick(100);
  await flush();
  assert.equal(f.starts.length, 1);
  f.end();
  t.mock.timers.tick(0);
  await flush();
  assert.equal(f.starts.length, 2);
  f.words('La réplica completa', true);
  assert.equal(f.session.getSnapshot().transcript, 'La réplica completa');
  assert.equal(f.session.getSnapshot().error, null);
});

test('an interruption from the installed legacy bridge waits for a real foreground return', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  f.session.configure({ enabled: true, lang: 'es-ES', lineKey: 'scene:2', continuous: false });
  await flush();
  f.words('adelante');
  const { id } = f.events.find(event => event.type === 'recognition.start');

  // The old installer emits visibility false before forwarding the SDK error.
  f.controller.setForeground(false);
  f.window.__AI_THEATRE_NATIVE_RECEIVE__({ type: 'recognition.error', id, error: 'interrupted' });
  f.end();
  t.mock.timers.tick(20000);
  await flush();
  assert.equal(f.session.getSnapshot().errorCode, 'interrupted');
  assert.equal(f.session.getSnapshot().lastUtterance, null);
  assert.equal(f.starts.length, 1);

  f.controller.setForeground(true);
  await flush();
  assert.equal(f.starts.length, 2);
  assert.equal(f.session.getSnapshot().error, null);
  assert.equal(sceneCommandReady(f.session.getSnapshot()), false);
  f.words('adelante');
  f.end();
  assert.equal(sceneCommandReady(f.session.getSnapshot()), true);
});

test('cancelling a pending permission cannot open a microphone after the user eventually grants it',async t=>{
  const permission=deferred(),f=fixture(t,{requestPermission:()=>permission.promise});await f.open();
  f.session.stop();permission.resolve(true);await flush();
  assert.equal(f.starts.length,0);assert.equal(await f.session.waitForEnd(),true);
});

test('only the newest queued speech can play after a delayed native closure',async t=>{
  const f=fixture(t);await f.open();
  const first=new f.window.SpeechSynthesisUtterance('Cancelada.'),second=new f.window.SpeechSynthesisUtterance('Actual.');
  f.window.speechSynthesis.speak(first);await flush();f.window.speechSynthesis.cancel();f.window.speechSynthesis.speak(second);await flush();
  assert.equal(f.spoken.length,0);f.end();await flush();
  assert.deepEqual(f.spoken.map(item=>item.text),['Actual.']);
});

test('a missing native terminal event reports failure without pretending capture ended or playing over it',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);await f.open();
  const utterance=new f.window.SpeechSynthesisUtterance('No debe sonar.');let failed=false;
  utterance.onerror=()=>{failed=true};f.window.speechSynthesis.speak(utterance);await flush();
  t.mock.timers.tick(8000);await flush();assert.equal(failed,true);assert.equal(f.spoken.length,0);
  f.end();
});

test('explicit native stop can keep the final recognition result, whereas abort discards late text',async t=>{
  const f=fixture(t);await f.open();
  const firstId=f.events.find(event=>event.type==='recognition.start').id;
  f.controller.handle(command('recognition.stop',firstId));f.words('Resultado final',true);
  assert.equal(f.session.getSnapshot().transcript,'Resultado final');f.end();
  f.session.activate({lang:'es-ES',lineKey:'next'});await flush();f.words('Nueva');
  f.session.stop();f.words('OLD LATE ABORT RESULT',true);
  assert.equal(f.session.getSnapshot().transcript,'Nueva');f.end();
});

test('an Android speech timeout reopens native input while keeping words across a long pause',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(t);await f.open();f.words('Primera parte');
  f.controller.recognitionEvent('error',{error:'speech-timeout',message:'No speech input'});f.end();
  assert.equal(f.session.getSnapshot().transcript,'Primera parte');
  assert.notEqual(f.session.getSnapshot().status,'error');
  t.mock.timers.tick(0);await flush();
  assert.equal(f.starts.length,2);f.words('segunda parte',true);
  assert.equal(f.session.getSnapshot().transcript,'Primera parte segunda parte');
  assert.equal(f.spoken.length,0);
});

test('a reloaded WebView cannot confuse the retired capture or speech callbacks with its new runs',async t=>{
  const f=fixture(t);await f.open();
  const firstInput=f.events.find(e=>e.type==='recognition.start').id;
  const reload=()=>{
    delete f.window.__AI_THEATRE_NATIVE_V1__;
    vm.runInNewContext(nativeBridgeBootstrap({platform:'ios',appVersion:'2026.11.225'}),{window:f.window,Event,Map,JSON});
  };
  reload();
  const next=new f.window.SpeechRecognition();let ended=0,text='';
  next.onend=()=>ended++;next.onresult=e=>{text=e.results[0][0].transcript};next.start();await flush();
  f.end();await flush();
  assert.notEqual(next.id,firstInput);assert(next.id);assert.equal(ended,0);
  f.words('Palabras nuevas',true);assert.equal(text,'Palabras nuevas');f.end();assert.equal(ended,1);
  const oldSpeech=new f.window.SpeechSynthesisUtterance('Voz antigua');f.window.speechSynthesis.speak(oldSpeech);await flush();
  const previous=f.spoken.at(-1);
  reload();
  const current=new f.window.SpeechSynthesisUtterance('Voz actual');let speechEnded=0;
  current.onend=()=>speechEnded++;f.window.speechSynthesis.speak(current);await flush();
  previous.options.onDone();assert.equal(speechEnded,0);assert.equal(f.window.speechSynthesis.speaking,true);
  f.spoken.at(-1).options.onDone();assert.equal(speechEnded,1);
});
