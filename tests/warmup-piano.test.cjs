const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
const old=require.extensions['.ts'];
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {joinPreparedPiano:join,createWarmupPianoPreparation:create}=require('../src/utils/warmupPiano.ts');
if(old)require.extensions['.ts']=old;else delete require.extensions['.ts'];
const track=(key,phase='piano',url=key)=>({key,phase,exerciseId:'test',title:'M · Five notes · Re3',audio:{audioUrl:url,durationSeconds:.02,pcmFrames:320,pcmSampleRate:16000}});
function io(){let reads=0,decodes=0;const blobs=[],revoked=[];return {blobs,revoked,get reads(){return reads;},get decodes(){return decodes;},read:async()=>{reads++;return new ArrayBuffer(2);},decode:async()=>{decodes++;return{samples:new Float32Array(320).fill(.5),sampleRate:16000};},createUrl:(bytes,type)=>{const url='blob:'+blobs.length;blobs.push({url,bytes,type});return url;},revokeUrl:u=>revoked.push(u)};}
test('continuous piano preserves every frame and beat, with no inserted padding and zero seam discontinuity',()=>{
 const a={samples:new Float32Array(320).fill(.5),sampleRate:16000};const wav=join([a,a,a]),view=new DataView(wav);
 assert.equal(view.getUint32(24,true),16000);assert.equal(view.getUint32(40,true),3*320*2);assert.equal(wav.byteLength,44+3*320*2);
 for(const edge of [0,319,320,639,640,959])assert.equal(view.getInt16(44+edge*2,true),0);
 for(const interior of [100,420,740])assert.ok(view.getInt16(44+interior*2,true)>10000);
 assert.throws(()=>join([a,{...a,sampleRate:8000}]),/incompatible/);
});
test('one continuous buffer per piano run preserves explanations, advice and rest in order; repeats fetch/decode once',async()=>{
 const transport=io(),p=create(transport),tracks=[track('ex','explanation'),track('a'),track('a-repeat','piano','a'),track('tip','tip'),track('b'),track('rest','rest')];
 const prepared=await p.prepare(tracks);
 assert.deepEqual(prepared.map(t=>t.phase),['explanation','piano','tip','piano','rest']);
 assert.equal(prepared[1].audio.durationSeconds,.04);assert.equal(prepared[3].audio.durationSeconds,.02);
 assert.equal(transport.reads,5);assert.equal(transport.decodes,2);
 assert.equal(await p.prepare(tracks),prepared);assert.equal(transport.reads,5);
 assert.equal(transport.blobs.filter(b=>b.type==='audio/wav').length,2);
 p.clear();assert.equal(transport.revoked.length,transport.blobs.length);p.clear();assert.equal(transport.revoked.length,transport.blobs.length);
});
test('a decoder without gapless support keeps buffered original clips instead of trimming or changing their notes',async()=>{
 const transport=io();transport.decode=async()=>{throw Error('codec');};const p=create(transport);
 const original=[track('a'),track('b')],prepared=await p.prepare(original);
 assert.deepEqual(prepared.map(t=>t.key),['a','b']);assert.ok(transport.blobs.every(b=>b.type==='audio/mpeg'));
 p.clear();
});
test('legacy MP3s without exact PCM lengths still play through the compatible buffered path',async()=>{
 const transport=io(),p=create(transport),a=track('legacy');delete a.audio.pcmFrames;delete a.audio.pcmSampleRate;
 assert.equal((await p.prepare([a]))[0].key,'legacy');assert.equal(transport.decodes,0);p.clear();
});
test('a cancelled or unmounted preparation cannot create playable URLs or replace a newer cache',async()=>{
 const transport=io();let finish;transport.read=()=>new Promise(r=>finish=r);const p=create(transport),controller=new AbortController();
 const pending=p.prepare([track('slow')],controller.signal);controller.abort();finish(new ArrayBuffer(2));await assert.rejects(pending,/cancelled/);assert.equal(transport.blobs.length,0);
 const next=p.prepare([track('unmounted')]);p.clear();finish(new ArrayBuffer(2));await assert.rejects(next,/cancelled/);assert.equal(transport.blobs.length,0);
});
test('failed loading can retry, and replacing a plan releases its old buffers only after the new plan is ready',async()=>{
 const transport=io(),p=create(transport),read=transport.read;let fail=true;transport.read=async(...args)=>{if(fail)throw Error('offline');return read(...args);};
 await assert.rejects(p.prepare([track('a')]),/offline/);assert.equal(transport.blobs.length,0);
 fail=false;await p.prepare([track('a')]);assert.deepEqual(transport.revoked,[]);await p.prepare([track('b')]);assert.deepEqual(transport.revoked,['blob:0']);p.clear();assert.deepEqual(transport.revoked,['blob:0','blob:1']);
});
