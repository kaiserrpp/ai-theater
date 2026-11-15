const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
test('native recognition reports keep requested language options and raw words, dropping unbounded hints and audio', async t => {
  const saved = [], previousLoad = Module._load, previousToken = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = 'unit-test-only';
  t.after(()=>{if(previousToken===undefined)delete process.env.BLOB_READ_WRITE_TOKEN;else process.env.BLOB_READ_WRITE_TOKEN=previousToken;});
  Module._load=function(name,...args){
    if(name==='@vercel/blob')return{put:async(pathname,text)=>{saved.push({pathname,body:JSON.parse(text)});return{url:'https://example.test/report'}}};
    if(name==='./_shared')return{getStorageNamespace:()=> 'preview',parseJsonBody:r=>r.body};
    return previousLoad.call(this,name,...args);
  };
  let handler;try{handler=require('../api/shared-script/intelligent-feedback.js')}finally{Module._load=previousLoad;}
  const response={status(code){this.code=code;return this},json(body){this.body=body}};
  const info={lang:'en-US',languageMode:'switch_requested',onDeviceRequested:true,localeStatus:'installed',contextTermCount:35,
    fallbackReason:null,detectedLanguage:'en-US',contextualStrings:['SECRET_HINT_ONLY'],audio:'AUDIO_NOT_ALLOWED'};
  await handler({method:'POST',body:{sessionId:'native-language-report',scriptId:'work',appVersion:'2026.11.232',nativeAppVersion:'2026.11.232',runtime:'native_android',entries:[
    {recognitionEngine:'native',expectedText:'Really?',heardText:'reality',result:'auto_avance',nativeRecognition:info},
    {recognitionEngine:'native',expectedText:'Sure',heardText:'Sur',nativeRecognition:{...info,languageMode:'single_locale',fallbackReason:'ios_single_locale',contextTermCount:200}},
    {recognitionEngine:'native',expectedText:'Hello',heardText:'hello',nativeRecognition:{...info,lang:'bad/script'}},
    {recognitionEngine:'whisper',expectedText:'Hello',heardText:'hello',nativeRecognition:info},
  ]}},response);
  assert.equal(response.code,200);assert.equal(saved[0].body.environment,'preview');
  assert.equal(saved[0].body.entries[0].heardText,'reality');
  const metadata=saved[0].body.entries[0].nativeRecognition;
  assert.equal(metadata.languageMode,'switch_requested');assert.equal(metadata.detectedLanguage,'en-US');
  assert.equal(saved[0].body.entries[1].nativeRecognition.contextTermCount,40);
  assert.equal(saved[0].body.entries[2].nativeRecognition,undefined);
  assert.equal(saved[0].body.entries[3].nativeRecognition,undefined);
  assert(!JSON.stringify(saved).includes('SECRET_HINT_ONLY'));assert(!JSON.stringify(saved).includes('AUDIO_NOT_ALLOWED'));
});
