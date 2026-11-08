const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,filename);
const { performMusicalAuditionSave: save, resolveAuditionAudioMimeType: mime } = require('../src/utils/saveMusicalAudition.ts');
if(previousLoader)require.extensions['.ts']=previousLoader;else delete require.extensions['.ts'];

test('a failed second upload retains the first, and retry reuses already uploaded files after a registration failure', async () => {
  let cut={id:'cut',revision:1,musicalNumberId:'number',audios:[]};
  const cached=new Map(), uploaded=[],completed=[],pending={vocal_guide:new File(['voice'],'voice.m4a'),karaoke:new File(['karaoke'],'karaoke.mp3')};
  const files=()=>Object.entries(pending).map(([kind,file])=>({kind,file}));
  let fail=true;
  const operations={
    uploadedFiles:cached,saveDetails:async()=>({musicalAuditions:[cut]}),
    upload:async(file,kind)=>{uploaded.push(kind);return {url:`https://example.com/${file.name}`,fileName:file.name};},
    saveAudio:async(current,kind,upload)=>{if(kind==='karaoke'&&fail)throw new Error('network');cut={...current,revision:current.revision+1,audios:[...current.audios,{kind,audioUrl:upload.url}]};return {musicalAuditions:[cut]};},
    removeAudio:async()=>{throw new Error('unexpected delete');},onCommitted:()=>{},
    onFileCommitted:kind=>{completed.push(kind);delete pending[kind];},
  };
  await assert.rejects(save({auditionId:'cut'},files(),[],operations),/network/);
  assert.deepEqual(completed,['vocal_guide']);assert.equal(cut.audios.length,1);assert.deepEqual(uploaded,['vocal_guide','karaoke']);
  fail=false;await save({auditionId:'cut'},files(),[],operations);
  assert.deepEqual(uploaded,['vocal_guide','karaoke']);assert.equal(cut.audios.length,2);assert.deepEqual(completed,['vocal_guide','karaoke']);
});
test('empty or generic iPhone MIME types are inferred from audio file extensions', () => {
  assert.equal(mime('nota.M4A',''),'audio/mp4');assert.equal(mime('tema.mp3','application/octet-stream'),'audio/mpeg');
  assert.equal(mime('ensayo.wav','audio/wav'),'audio/wav');assert.equal(mime('guion.pdf','application/pdf'),null);
});
