const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const previousLoader=require.extensions['.ts'],previousLoad=Module._load;
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
Module._load=function(name,...args){return name==='expo-constants'?{default:{expoConfig:{version:'test'}}}:previousLoad.call(this,name,...args)};
const {preloadWhisperSpeechRecognition:preload,disposeWhisperSpeechRecognition:dispose,getWhisperSpeechRecognitionConstructor:getConstructor}=require('../src/utils/whisperSpeechRecognition.web.ts');
Module._load=previousLoad;if(previousLoader)require.extensions['.ts']=previousLoader;else delete require.extensions['.ts'];

test('a hung model is released and a fresh retry ignores errors from the terminated worker',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const previousWindow=global.window,previousWorker=global.Worker,workers=[];
 global.window={location:{href:'http://localhost/'}};global.Worker=class{constructor(){this.messages=[];workers.push(this)}postMessage(message){this.messages.push(message)}terminate(){this.terminated=true}};
 t.after(()=>{dispose();global.window=previousWindow;global.Worker=previousWorker});
 const first=preload(),rejected=assert.rejects(first,/tardado demasiado/);const lateError=workers[0].onerror;
 t.mock.timers.tick(120000);await rejected;assert.equal(workers[0].terminated,true);
 const second=preload();assert.equal(workers.length,2);lateError({message:'old failure'});assert.equal(workers[1].terminated,undefined);
 workers[1].onmessage({data:{type:'ready',id:workers[1].messages[0].id}});await second;
 await preload();assert.equal(workers.length,2,'a loaded model stays warm');
});

test('streamed words and live timings arrive before completion, and cancelling rejects all later chunks',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {setImmediate:settle}=require('node:timers/promises');
 const previousWindow=global.window,previousWorker=global.Worker,previousAudioContext=global.AudioContext;
 const previousNavigator=Object.getOwnPropertyDescriptor(global,'navigator');
 const workers=[],processors=[],timings=[],events=[];
 const node=()=>({connect(){},disconnect(){}});
 class AudioContext{
  constructor(){this.sampleRate=16000;this.state='running';this.destination={}}
  createMediaStreamSource(){return node()}
  createScriptProcessor(){const p=node();processors.push(p);return p}
  createGain(){return {...node(),gain:{value:0}}}
  async close(){}
 }
 global.AudioContext=AudioContext;global.window={location:{href:'http://localhost/'},AudioContext};
 Object.defineProperty(global,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}}});
 global.Worker=class{constructor(){this.messages=[];workers.push(this)}postMessage(m){this.messages.push(m)}terminate(){}};
 t.after(()=>{dispose();global.window=previousWindow;global.Worker=previousWorker;global.AudioContext=previousAudioContext;if(previousNavigator)Object.defineProperty(global,'navigator',previousNavigator);else delete global.navigator});
 const ready=preload();workers[0].onmessage({data:{type:'ready',id:workers[0].messages[0].id}});await ready;
 const Constructor=getConstructor(()=>undefined,()=> 'spanish',timing=>timings.push(timing));
 const recognition=new Constructor();recognition.onresult=event=>events.push(event);recognition.start();await settle();
 processors[0].onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(16000).fill(0.2)}});
 t.mock.timers.tick(350);await settle();
 const request=workers[0].messages.find(m=>m.type==='transcribe');
 assert.equal(request.language,'spanish');assert.equal(request.context,undefined);
 const reply=(type,text)=>workers[0].onmessage({data:{type,id:request.id,text,processingMs:250,queueMs:12,audioDurationMs:1000,
  encoderDevice:'webgpu',decoderDevice:'wasm',encoderDtype:'fp32',fallbackReason:null}});
 reply('partial','prueba de');reply('partial','prueba de micro');
 assert.equal(events.length,2);assert.equal(events[1].results[0].isFinal,false);assert.equal(events[1].results[0][0].transcript,'prueba de micro');
 assert.equal(timings.at(-1).kind,'live_processing');assert.equal(timings.at(-1).processingMs,250);assert.equal(timings.at(-1).queueMs,12);
 assert.equal(timings.at(-1).encoderDevice,'webgpu');
 reply('result','prueba de micro');await settle();
 const timingOfDisplayedWords=timings.at(-1),eventCount=events.length;
 processors[0].onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(16000).fill(0.2)}});
 t.mock.timers.tick(350);await settle();
 assert.equal(timings.at(-1),timingOfDisplayedWords,'a new pending inference must not erase timing of the text still displayed');
 const nextRequest=workers[0].messages.filter(m=>m.type==='transcribe').at(-1);
 recognition.abort();await settle();
 const count=timings.length;
 reply('partial','adelante');reply('result','obsolete result');await settle();
 workers[0].onmessage({data:{type:'partial',id:nextRequest.id,text:'stale words'}});
 assert.equal(events.length,eventCount);assert.equal(timings.length,count);
 assert(workers[0].messages.some(m=>m.type==='cancel'&&m.session===request.session));

 const checkEvents=[],rehearsalRequests=workers[0].messages.filter(m=>m.type==='transcribe').length;
 const CheckConstructor=getConstructor(()=>({prompt:'Sonny, English'}),()=> 'auto',undefined,()=>true);
 const check=new CheckConstructor();check.onresult=event=>checkEvents.push(event);check.start();await settle();
 processors.at(-1).onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(64000).fill(0.2)}});
 t.mock.timers.tick(10000);await settle();
 assert.equal(workers[0].messages.filter(m=>m.type==='transcribe').length,rehearsalRequests,'setup never transcribes a growing fragment');
 assert.equal(check.finishInput(),true);
 const checkRequest=workers[0].messages.filter(m=>m.type==='transcribe').at(-1);
 assert.equal(checkRequest.language,'spanish');assert.equal(checkRequest.context,undefined);
 workers[0].onmessage({data:{type:'partial',id:checkRequest.id,text:'prueba de micro'}});
 assert.equal(checkEvents.length,0,'provisional guesses cannot validate setup');
 workers[0].onmessage({data:{type:'result',id:checkRequest.id,text:'Hola, esta es una prueba de micro.'}});await settle();
 assert.equal(checkEvents.length,1);assert.equal(checkEvents[0].results[0].isFinal,true);
 assert.equal(workers.length,1,'retry/setup and rehearsal share the loaded worker');
});
