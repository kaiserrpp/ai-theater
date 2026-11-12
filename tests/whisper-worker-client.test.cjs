const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const previousLoader=require.extensions['.ts'],previousLoad=Module._load;
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
Module._load=function(name,...args){return name==='expo-constants'?{default:{expoConfig:{version:'test'}}}:previousLoad.call(this,name,...args)};
const {preloadWhisperSpeechRecognition:preload,disposeWhisperSpeechRecognition:dispose}=require('../src/utils/whisperSpeechRecognition.web.ts');
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
