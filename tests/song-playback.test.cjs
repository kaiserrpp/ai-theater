const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const previousLoader = require.extensions['.ts'];
require.extensions['.ts'] = (loadedModule, filename) => loadedModule._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,filename);
const { createSongPlayback } = require('../src/utils/songPlayback.ts');
if(previousLoader)require.extensions['.ts']=previousLoader;else delete require.extensions['.ts'];

const tracks = ['one','two','three'].map(key=>({key,audio:{audioUrl:`https://example.com/${key}.mp3`}}));
const setup = () => {
  const state={key:null,playing:false,position:0,duration:0,error:'',queue:null};
  let created=0;
  const audio={src:'',currentTime:0,duration:10,ended:false,loop:false,playbackRate:1,calls:0,
    pause(){this.onpause?.();},load(){this.currentTime=0;this.ended=false;this.onloadedmetadata?.();},
    play(){this.calls++;this.onplay?.();return Promise.resolve();},
    finish(){this.currentTime=this.duration;this.ended=true;this.ontimeupdate?.();this.onended?.();},
  };
  const player=createSongPlayback({createAudio:()=>{created++;return audio;},onTrack:key=>{state.key=key;},onPlaying:value=>{state.playing=value;},
    onPosition:value=>{state.position=value;},onDuration:value=>{state.duration=value;},onQueue:value=>{state.queue=value;},onError:value=>{state.error=value;}});
  return {player,audio,state,created:()=>created};
};

test('the playlist advances through its entries and wraps to the first by default using one audio element', () => {
  const {player,audio,state,created}=setup();player.play(tracks[0],tracks);
  assert.equal(state.key,'one');audio.finish();assert.equal(state.key,'two');audio.finish();assert.equal(state.key,'three');
  audio.finish();assert.equal(state.key,'one');assert.equal(state.playing,true);assert.equal(state.position,0);
  assert.deepEqual(state.queue,{index:0,total:3});assert.equal(created(),1);assert.equal(audio.calls,4);
});
test('a queue of one restarts, and a filtered queue never adds excluded tracks', () => {
  const {player,audio,state}=setup();player.play(tracks[1],[tracks[1]]);audio.finish();assert.equal(state.key,'two');assert.equal(audio.currentTime,0);
  player.play(tracks[0],[tracks[0],tracks[2]]);audio.finish();assert.equal(state.key,'three');audio.finish();assert.equal(state.key,'one');
  assert.deepEqual(state.queue,{index:0,total:2});
});
test('turning repeat off still advances the queue but stops at its last entry', () => {
  const {player,audio,state}=setup();player.setRepeat('off');player.play(tracks[0],tracks);
  audio.finish();assert.equal(state.key,'two');audio.finish();assert.equal(state.key,'three');const calls=audio.calls;
  audio.finish();assert.equal(state.playing,false);assert.equal(state.key,'three');assert.equal(audio.calls,calls);
});
test('repeat song uses the native loop without losing speed, and switching back restores queue advancement', () => {
  const {player,audio,state}=setup();player.play(tracks[0],tracks);player.setRate(0.8);player.setRepeat('track');
  assert.equal(audio.loop,true);audio.finish();assert.equal(state.key,'one');assert.equal(audio.playbackRate,0.8);
  player.setRepeat('queue');assert.equal(audio.loop,false);audio.finish();assert.equal(state.key,'two');assert.equal(audio.playbackRate,0.8);
});
test('pause and resume keep the same position and queue, while close cancels late ended events', () => {
  const {player,audio,state}=setup();player.play(tracks[0],tracks);player.seek(4);player.pause();assert.equal(state.playing,false);
  player.resume();assert.equal(state.position,4);assert.equal(state.playing,true);
  const lateEnd=audio.onended;player.stop();lateEnd();assert.equal(state.key,null);assert.equal(state.playing,false);assert.deepEqual(state.queue,{index:-1,total:0});
});
test('deleted queue entries are skipped and deleting the current track stops playback', () => {
  const {player,audio,state}=setup();player.play(tracks[0],tracks);player.updateTracks([tracks[0],tracks[2]]);audio.finish();assert.equal(state.key,'three');
  player.updateTracks([tracks[0]]);assert.equal(state.key,null);assert.equal(state.playing,false);
});
test('a rejected play promise from a previous track cannot interrupt a newer track or restart on failure', async () => {
  const {player,audio,state}=setup();let reject;
  audio.play=()=>new Promise((_,fail)=>{reject=fail;});player.play(tracks[0],tracks);
  audio.play=()=>{audio.onplay?.();return Promise.resolve();};player.play(tracks[1],tracks);reject(new Error('old request'));await Promise.resolve();
  assert.equal(state.key,'two');assert.equal(state.error,'');assert.equal(state.playing,true);
  audio.play=()=>Promise.reject(new Error('blocked'));audio.finish();await Promise.resolve();
  assert.equal(state.key,'three');assert.equal(state.playing,false);assert.match(state.error,/Pulsa reproducir/);
});
