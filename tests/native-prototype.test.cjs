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
if (previous) require.extensions['.ts'] = previous; else delete require.extensions['.ts'];
const command = (type, id, extra = {}) => ({ channel: 'ai-theatre-native', protocol: 1, type, id, ...extra });
const deferred = () => { let resolve;const promise=new Promise(done=>{resolve=done});return{promise,resolve}; };
const flush = async () => { await settle();await settle(); };

const fixture = (t, extra = {}) => {
  const events=[], starts=[], spoken=[], calls=[];
  let active=false, speech=false;
  const window=Object.assign(new EventTarget(), { ReactNativeWebView: { postMessage: text => controller.handle(parseBridgeCommand(text)) } });
  const controller=createNativePrototypeController({
    emit:event=>{events.push(event);window.__AI_THEATRE_NATIVE_RECEIVE__?.(event)},
    requestPermission:extra.requestPermission||(async()=>true),isRecognitionAvailable:()=>true,
    startRecognition:options=>{assert.equal(speech,false);active=true;starts.push(options);controller.recognitionEvent('start');controller.recognitionEvent('audiostart')},
    abortRecognition:()=>calls.push('abort'),stopRecognition:()=>calls.push('stop'),
    speak:(text,options)=>{assert.equal(active,false,'native playback cannot overlap capture');speech=true;spoken.push({text,options});options.onStart()},
    stopSpeech:async()=>{speech=false;calls.push('stopSpeech')},voices:async()=>[],
  });
  vm.runInNewContext(nativeBridgeBootstrap({platform:'ios',appVersion:'2026.11.224'}),{window,Event,Map,JSON});
  const snapshots=[];
  const session=createSpeechRecognitionSession(window.SpeechRecognition,s=>snapshots.push(s),{
    controlledEnd:true,prepareRestart:()=>{throw Error('Native recognition must not require the Safari speech cue')},
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
