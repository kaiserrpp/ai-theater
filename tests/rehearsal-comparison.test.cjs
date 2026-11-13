const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript');
const { setImmediate: settle } = require('node:timers/promises');
const previous = require.extensions['.ts'];
require.extensions['.ts'] = (m, filename) => m._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { createRehearsalComparisonSession } = require('../src/utils/rehearsalComparisonSession.ts');
const { createFinalizableVoskRecognizer } = require('../src/utils/finalizableVoskRecognizer.ts');
const { makeRehearsalComparisonEntry } = require('../src/utils/rehearsalComparisonFeedback.ts');
if (previous) require.extensions['.ts'] = previous; else delete require.extensions['.ts'];
const { normalizeRehearsalComparison } = require('../shared/rehearsalComparison');
const deferred = () => { let resolve; const promise = new Promise(r=>{resolve=r}); return {promise,resolve}; };
const fixture = t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let now=0, captures=0, closed=0, frame, nativeCallbacks, nativeClosed;
  const records=[], snapshots=[], callbacks={}, received={vosk:[],whisper:[]};
  const session=createRehearsalComparisonSession({ now:()=>now, speechThreshold:()=>0.006,
    prepare:async()=>({}), prepareNative:async()=>{},
    openCapture:async cb=>{frame=cb;captures++;let active=true;return{sampleRate:16000,close(){if(active){active=false;closed++}}}},
    createDecoder:async(engine,_rate,_turn,cb)=>{callbacks[engine]=cb;return{on(){},acceptWaveform:buffer=>received[engine].push(buffer),
      finishInput:()=>{cb.final(engine==='vosk'?'algo distinto':'otra cosa');cb.finished();return true},remove(){}}},
    openNative:(_lang,cb)=>{nativeCallbacks=cb;nativeClosed=deferred();cb.ready();return{closed:nativeClosed.promise,finish(){},abandon(){cb.ended();nativeClosed.resolve()}}},
    onChange:s=>snapshots.push(s),onResult:r=>records.push(r),
  });
  t.after(session.dispose);
  return{session,records,snapshots,callbacks,received,
    open:key=>session.open({key,id:key,lang:'es-ES',context:{names:[],vocabulary:[],prompt:''}}),
    tick:async ms=>{now+=ms;t.mock.timers.tick(ms);await settle()},
    feed:value=>{const buffer={getChannelData:()=>new Float32Array(640).fill(value)};frame(buffer);return buffer},
    nativeText:text=>nativeCallbacks.text(text,true), nativeEnd:()=>{nativeCallbacks.ended();nativeClosed.resolve()},
    captureCounts:()=>({captures,closed}),
  };
};

test('one actor take feeds both local decoders while native listens, and zero scores never block completion',async t=>{
  const f=fixture(t);await f.open('line:0');
  const frame=f.feed(.2);f.nativeText('sin relación con el guion');
  assert.equal(f.received.vosk[0],frame);assert.equal(f.received.whisper[0],frame);
  await f.tick(1999);assert.equal(f.records.length,0);assert.equal(f.captureCounts().closed,0);
  f.nativeEnd();await f.tick(1);
  assert.equal(f.captureCounts().captures,1);assert.equal(f.captureCounts().closed,1);
  assert.equal(f.records.length,1);assert.equal(f.records[0].completion,'speech_end');
  assert.equal(f.records[0].speechStartMs,0);assert.equal(f.records[0].speechEndMs,0);assert.equal(f.records[0].inputClosedMs,2000);
  const entry=makeRehearsalComparisonEntry(f.records[0],{lineIndex:4,character:'ACTOR',sceneTitle:'ESCENA',expectedText:'Hola',speakableText:'Hola',language:'es-ES'});
  assert.equal(entry.rehearsalComparison.results.length,3);
  assert(entry.rehearsalComparison.results.every(r=>r.score===0));
  assert.equal(entry.result,'comparacion_ensayo');
});

test('a short pause keeps listening, and an explicit pause preserves words for the same actor turn',async t=>{
  const f=fixture(t);await f.open('line:0');f.feed(.2);
  f.callbacks.vosk.final('primera parte');f.callbacks.whisper.final('primera parte');f.nativeText('primera parte');
  await f.tick(1500);assert.equal(f.records.length,0);
  f.session.suspend();f.nativeEnd();await f.tick(5000);assert.equal(f.records.length,0);
  await f.open('line:0');f.nativeText('segunda parte');f.feed(.2);f.nativeEnd();
  f.session.finish('button');
  assert.equal(f.records.length,1);assert.equal(f.records[0].results[0].text,'primera parte segunda parte');
  assert(f.records[0].results.find(r=>r.engine==='vosk').text.startsWith('primera parte'));
});

test('a partial report snapshots three unfinished outputs without closing, advancing or replacing the live take',async t=>{
  const f=fixture(t);await f.open('line:0');f.feed(.2);
  f.callbacks.vosk.partial('primera');f.callbacks.whisper.partial('otra');f.nativeText('texto nativo');
  const snapshot=f.session.snapshotForReport();
  assert.equal(snapshot.completion,'report_snapshot');assert.equal(snapshot.inputClosedMs,null);
  assert(snapshot.results.every(item=>item.status==='incomplete'));
  assert.equal(f.captureCounts().closed,0);assert.equal(f.records.length,0);
  assert.equal(f.snapshots.at(-1).phase,'listening');
  const metadata={lineIndex:4,character:'ACTOR',sceneTitle:'ESCENA',expectedText:'Hola',speakableText:'Hola',language:'es-ES'};
  const entry=makeRehearsalComparisonEntry(snapshot,metadata);
  assert.equal(entry.result,'informe_parcial');
  assert.equal(normalizeRehearsalComparison(entry.rehearsalComparison).completion,'report_snapshot');
  f.callbacks.vosk.partial('primera segunda');
  assert.equal(snapshot.results.find(item=>item.engine==='vosk').text,'primera');
  assert.notEqual(f.session.snapshotForReport().turn.id,snapshot.turn.id);
  f.nativeEnd();f.session.finish('button');
  assert.equal(f.records.length,1);assert.equal(f.records[0].turn.id,'line:0');
  assert.notEqual(f.records[0].turn.id,snapshot.turn.id);
  assert.equal(f.session.snapshotForReport(),null);
});

test('sending a snapshot while paused keeps the words and permits resuming the same comparison',async t=>{
  const f=fixture(t);await f.open('line:0');f.feed(.2);
  f.callbacks.vosk.final('primera parte');f.nativeText('primera parte');
  f.session.suspend();f.nativeEnd();
  const before=f.captureCounts();const snapshot=f.session.snapshotForReport();
  assert.equal(snapshot.results.find(item=>item.engine==='vosk').text,'primera parte');
  assert.deepEqual(f.captureCounts(),before);assert.equal(f.records.length,0);
  await f.open('line:0');f.nativeText('segunda parte');f.feed(.2);f.nativeEnd();f.session.finish('button');
  assert.equal(f.records.length,1);
  assert.equal(f.records[0].results.find(item=>item.engine==='native').text,'primera parte segunda parte');
});

test('a skipped line is retained before the next cue, and late results cannot rewrite it',async t=>{
  const f=fixture(t);await f.open('first:0');f.feed(.2);f.session.finish('manual');
  assert.equal(f.records.length,0,'native still closing');f.nativeEnd();assert.equal(f.records.length,1);
  const old=f.callbacks.whisper;await f.open('second:0');old.partial('LATE');
  assert.equal(f.records[0].turn.key,'first:0');
  assert(!f.snapshots.at(-1).results.some(r=>r.text==='LATE'));
});

test('a failed motor is recorded with its error while the other two still finish the scene take',async t=>{
  const f=fixture(t);await f.open('line:0');f.callbacks.whisper.error('GPU failed');f.feed(.2);f.nativeText('hola');f.nativeEnd();
  await f.tick(2000);assert.equal(f.records.length,1);
  assert.equal(f.records[0].results.find(r=>r.engine==='whisper').status,'error');
  assert.equal(f.records[0].results.find(r=>r.engine==='whisper').error,'GPU failed');
});

test('leaving an unfinished turn preserves an interrupted result rather than dropping the actor line',async t=>{
  const f=fixture(t);await f.open('line:0');f.feed(.2);f.callbacks.whisper.partial('palabras parciales');f.session.dispose();
  assert.equal(f.records.length,1);assert.equal(f.records[0].completion,'exit');
  assert.equal(f.records[0].results.find(r=>r.engine==='whisper').text,'palabras parciales');
});

test('Vosk drains frame acknowledgements before requesting the final result and preserves that final text',()=>{
  const sourceListeners={}, delivered=[];let requested=0,finished=0;
  const source={on:(event,cb)=>{sourceListeners[event]=cb},acceptWaveform(){},retrieveFinalResult(){requested++},remove(){}};
  const decoder=createFinalizableVoskRecognizer(source,()=>{finished++});
  decoder.on('result',e=>delivered.push(e.result.text));
  decoder.acceptWaveform({});decoder.acceptWaveform({});decoder.finishInput();assert.equal(requested,0);
  sourceListeners.result({result:{text:'primera parte'}});assert.equal(requested,0);assert.equal(finished,0);
  sourceListeners.partialresult({result:{partial:'otra'}});assert.equal(requested,1);assert.equal(finished,0);
  sourceListeners.result({result:{text:'últimas palabras'}});assert.equal(finished,1);
  assert.deepEqual(delivered,['primera parte','últimas palabras']);decoder.remove();
});

test('the shared report stores three raw outputs and bounded scores without retaining PCM or unrecognized fields',()=>{
  const output=normalizeRehearsalComparison({id:'paired',execution:'parallel',completion:'speech_end',elapsedMs:5000,quietMs:2000,audio:'SECRET AUDIO',
    results:['native','vosk','whisper'].map(engine=>({engine,text:'lo que oyó',status:'done',score:.3,firstTextMs:800,audio:'SECRET AUDIO'}))});
  assert.equal(output.results.length,3);assert.equal(output.results[2].score,.3);
  assert.equal(output.sameUtterance,true);assert.deepEqual(output.sharedPcm,['vosk','whisper']);
  assert(!JSON.stringify(output).includes('SECRET'));assert.equal(normalizeRehearsalComparison({execution:'sequential'}),null);
});

test('the published feedback API retains one actor line with all three outputs, including a failed engine', async t=>{
  const blobPath=require.resolve('@vercel/blob'), original=require(blobPath);let stored;
  require.cache[blobPath].exports={...original,put:async(_path,body)=>{stored=JSON.parse(body);return{url:'https://test/report.json'}}};
  const handlerPath=require.resolve('../api/shared-script/intelligent-feedback');delete require.cache[handlerPath];
  const handler=require(handlerPath);require.cache[blobPath].exports=original;
  const oldToken=process.env.BLOB_READ_WRITE_TOKEN;process.env.BLOB_READ_WRITE_TOKEN='test-only';
  t.after(()=>{if(oldToken===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=oldToken});
  const response={status(code){this.statusCode=code;return this},json(body){this.body=body},setHeader(){}};
  const entry={expectedText:'Hola',heardText:'resultados',recognitionEngine:'comparison',result:'comparacion_ensayo',
    rehearsalComparison:{id:'one-turn',execution:'parallel',completion:'speech_end',quietMs:2000,elapsedMs:4000,
      results:[{engine:'native',text:'Hola',status:'done',score:1},{engine:'vosk',text:'ola',status:'done',score:.8},
        {engine:'whisper',text:'',status:'error',score:0,error:'GPU unavailable',audio:'PRIVATE AUDIO'}]}};
  await handler({method:'POST',headers:{},body:{sessionId:'parallel-test',scriptId:'test',entries:[entry]}},response);
  assert.equal(response.statusCode,200);assert.equal(stored.entryCount,1);assert.equal(stored.entries[0].recognitionEngine,'comparison');
  assert.deepEqual(stored.entries[0].rehearsalComparison.results.map(x=>x.score),[1,.8,0]);
  assert.equal(stored.entries[0].rehearsalComparison.results[2].error,'GPU unavailable');
  assert(!JSON.stringify(stored).includes('PRIVATE AUDIO'));
});

test('leaving while capture permission is pending waits for and releases the late grant before another voice can start',async()=>{
  const pending=deferred();let requested=false,closed=0,nativeStarts=0;
  const session=createRehearsalComparisonSession({prepare:async()=>({}),prepareNative:async()=>{},speechThreshold:()=>.01,
    openCapture:async()=>{requested=true;return pending.promise},createDecoder:async()=>{throw Error('cancelled decoder should not be created')},
    openNative:()=>{nativeStarts++;throw Error('cancelled native should not start')},onChange(){},onResult(){}});
  const started=session.open({key:'line:0',id:'line',lang:'es-ES',context:{names:[],vocabulary:[],prompt:''}});
  await settle();assert(requested);session.finish('exit');let released=false;const waiting=session.waitForEnd().then(()=>{released=true});
  await settle();assert.equal(released,false);
  pending.resolve({sampleRate:16000,close(){closed++}});await started;await waiting;
  assert.equal(closed,1);assert.equal(nativeStarts,0);session.dispose();
});
