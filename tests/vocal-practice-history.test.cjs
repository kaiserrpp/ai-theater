const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs'),ts=require('typescript');
const old=require.extensions['.ts'];
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,file);
const {createVocalPracticeHistory:create,parseVocalPracticeHistory:parse,shouldWarmUpBeforeSinging:due,WARMUP_INTERVAL_MS:TWO_HOURS,VOCAL_PRACTICE_KEY:KEY}=require('../src/utils/vocalPracticeHistory.ts');
if(old)require.extensions['.ts']=old;else delete require.extensions['.ts'];

test('warmup is due on first use or strictly after two hours, with an explicit opt out',()=>{
 const now=100000000,history={enabled:true,lastActivityAt:now-TWO_HOURS};
 assert.equal(due(history,now),false);assert.equal(due(history,now+1),true);
 assert.equal(due({enabled:true,lastActivityAt:null},now),true);
 assert.equal(due({enabled:false,lastActivityAt:null},now),false);
 assert.equal(due({enabled:true,lastActivityAt:now+1},now),true);
 for(const broken of [null,'broken','{}','{"lastActivityAt":"yesterday"}','{"lastActivityAt":-5}'])assert.deepEqual(parse(broken),{enabled:true,lastActivityAt:null});
});
test('real playback activity extends the window during a long song and the pause records its end',async()=>{
 let clock=100000000,stored=null,writes=0;
 const h=create({getItem:async()=>stored,setItem:async(k,v)=>{assert.equal(k,KEY);stored=v;writes++;}},()=>clock);
 await h.load();assert.equal(h.due(),true);
 h.recordActivity(true);assert.equal(h.due(),false);
 clock+=TWO_HOURS-100;h.recordActivity();clock+=TWO_HOURS-100;assert.equal(h.due(),false);
 h.recordActivity(true);await h.flush();assert.equal(parse(stored).lastActivityAt,clock);assert.ok(writes<=3);
 clock+=TWO_HOURS+1;assert.equal(h.due(),true);
 const restored=create({getItem:async()=>stored,setItem:async()=>{}},()=>clock);await restored.load();assert.equal(restored.due(),true);
});
test('late hydration cannot replace a more recent warmup completion or opt-out',async()=>{
 let finishRead,stored;const h=create({getItem:()=>new Promise(r=>finishRead=r),setItem:async(_k,v)=>{stored=v;}},()=>20000000);
 const pending=h.load();h.recordActivity(true);h.setEnabled(false);
 finishRead(JSON.stringify({enabled:true,lastActivityAt:1}));await pending;await h.flush();
 assert.deepEqual(parse(stored),{enabled:false,lastActivityAt:20000000});assert.equal(h.due(),false);
});
test('serialized writes preserve the latest preference when older writes finish slowly',async()=>{
 let release,stored,calls=0;
 const h=create({getItem:async()=>null,setItem:async(_k,v)=>{if(++calls===1)await new Promise(r=>release=r);stored=v;}},()=>30000000);
 await h.load();h.setEnabled(false);await Promise.resolve();await Promise.resolve();await Promise.resolve();h.setEnabled(true);h.recordActivity(true);
 release();await h.flush();assert.deepEqual(parse(stored),{enabled:true,lastActivityAt:30000000});
});
test('storage errors leave the in-memory choice usable and never alter another app key',async()=>{
 const h=create({getItem:async k=>{assert.equal(k,KEY);throw Error('read');},setItem:async k=>{assert.equal(k,KEY);throw Error('write');}},()=>40000000);
 await h.load();assert.equal(h.getSnapshot().loaded,true);h.setEnabled(false);await h.flush();assert.equal(h.due(),false);assert.match(h.getSnapshot().error,/recordar/);
});
