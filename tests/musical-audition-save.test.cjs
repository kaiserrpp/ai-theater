const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,filename);
const { performMusicalAuditionSave: save, prepareAuditionMedia: prepare, resolveAuditionMediaMimeType: mediaMime, resolveAuditionAudioMimeType: mime } = require('../src/utils/saveMusicalAudition.ts');
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

test('iPhone videos are accepted as video for extraction, including generic MP4 and MOV files', () => {
  assert.equal(mediaMime('grabacion.MOV',''),'video/quicktime');
  assert.equal(mediaMime('cancion.mp4','application/octet-stream'),'video/mp4');
  assert.equal(mediaMime('grabacion','video/mp4'),'video/mp4');
  assert.equal(mediaMime('cancion.m4a','audio/mp4'),'audio/mp4');
  assert.equal(mediaMime('voz.webm','audio/webm'),'audio/webm');
  assert.equal(mediaMime('clip.webm',''),'video/webm');
  assert.equal(mediaMime('guion.pdf','application/pdf'),null);
});

test('audio files are uploaded directly without attempting video conversion', async () => {
  const file=new File(['audio'],'voice.m4a',{type:'audio/mp4'});
  const source={url:'https://example.com/voice.m4a',fileName:file.name};
  const result=await prepare(file,{sourceUploads:new Map(),upload:async()=>source,
    extract:async()=>{throw new Error('audio must not be converted');},onExtracting:()=>{throw new Error('unexpected stage');}});
  assert.equal(result,source);
});

test('retrying video conversion reuses the uploaded video and returns only extracted audio', async () => {
  const file=new File(['video'],'voice.mov',{type:'video/quicktime'}),sourceUploads=new Map();
  const source={url:'https://example.com/source.mov',pathname:'source.mov',fileName:file.name};
  const audio={url:'https://example.com/extracted.mp3',pathname:'extracted.mp3',fileName:'voice.mp3',contentType:'audio/mpeg'};
  let uploads=0,conversions=0,stages=0;
  const operations={sourceUploads,upload:async()=>{uploads++;return source;},onExtracting:()=>{stages++;},
    extract:async(value)=>{assert.equal(value,source);conversions++;if(conversions===1)throw new Error('conversion unavailable');return audio;}};
  await assert.rejects(prepare(file,operations),/conversion unavailable/);
  assert.equal(sourceUploads.get(file),source);
  assert.equal(await prepare(file,operations),audio);
  assert.equal(uploads,1);assert.equal(conversions,2);assert.equal(stages,2);assert.equal(sourceUploads.size,0);
});

test('a lost audio registration after extraction never reuploads or reconverts the video', async () => {
  const file=new File(['video'],'voice.mp4',{type:'video/mp4'}),sourceUploads=new Map(),uploadedFiles=new Map();
  let cut={id:'cut',revision:1,musicalNumberId:'number',audios:[]},uploads=0,conversions=0,registrations=0;
  const audio={url:'https://example.com/voice.mp3',fileName:'voice.mp3',contentType:'audio/mpeg'};
  const operations={uploadedFiles,saveDetails:async()=>({musicalAuditions:[cut]}),onCommitted:()=>{},onFileCommitted:()=>{},
    removeAudio:async()=>{throw new Error('unexpected removal');},
    upload:()=>prepare(file,{sourceUploads,upload:async()=>{uploads++;return {url:'https://example.com/voice.mp4'};},
      extract:async()=>{conversions++;return audio;},onExtracting:()=>{}}),
    saveAudio:async(current,kind,value)=>{assert.equal(value,audio);registrations++;if(registrations===1)throw new Error('registration failed');
      cut={...current,revision:current.revision+1,audios:[{kind,audioUrl:value.url}]};return {musicalAuditions:[cut]};},
  };
  await assert.rejects(save({auditionId:'cut'},[{kind:'vocal_guide',file}],[],operations),/registration failed/);
  await save({auditionId:'cut'},[{kind:'vocal_guide',file}],[],operations);
  assert.equal(uploads,1);assert.equal(conversions,1);assert.equal(cut.audios[0].audioUrl,audio.url);
});
