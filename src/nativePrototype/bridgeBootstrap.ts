import type { NativePlatform } from './protocol';

// Literal source is intentional: Hermes does not preserve function.toString()
// as executable source. This runs before the existing web application loads.
const BOOTSTRAP = String.raw`(function(config) {
  if (window.__AI_THEATRE_NATIVE_V1__) return;
  var info = { protocol: 1, platform: config.platform, appVersion: config.appVersion, foreground: true };
  var count = 0, inputs = new Map(), speech = null, voices = [];
  function send(data) { window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({channel:'ai-theatre-native',protocol:1},data))); }
  class Recognition {
    constructor() { this.lang='es-ES';this.continuous=false;this.interimResults=true;this.maxAlternatives=1;this.id=null;this.finals=[];this.ending=false; }
    start() {
      if(this.id) throw new Error('Recognition already started');
      this.id='r-'+(++count);this.finals=[];this.ending=false;inputs.set(this.id,this);
      send({type:'recognition.start',id:this.id,lang:this.lang,continuous:this.continuous});
    }
    abort() { if(this.id&&!this.ending){this.ending=true;send({type:'recognition.abort',id:this.id});} }
    stop() { if(this.id&&!this.ending){this.ending=true;send({type:'recognition.stop',id:this.id});} }
  }
  Recognition.controlledInputEnd=true;
  class Utterance { constructor(text){this.text=text;this.lang='es-ES';this.rate=.96;this.pitch=1;this.volume=1;this.voice=null;} }
  var synth={pending:false,speaking:false,paused:false,onvoiceschanged:null,getVoices:function(){return voices.slice();},resume:function(){},
    cancel:function(){speech=null;this.pending=false;this.speaking=false;send({type:'speech.cancel'});},
    speak:function(utterance){
      if(speech)this.cancel();
      speech={id:'s-'+(++count),utterance:utterance};this.pending=true;
      send({type:'speech.start',id:speech.id,text:utterance.text,lang:utterance.lang,rate:utterance.rate,pitch:utterance.pitch,volume:utterance.volume,voice:utterance.voice&&utterance.voice.id});
    }
  };
  window.__AI_THEATRE_NATIVE_RECEIVE__=function(event){
    if(event.type==='visibility'){
      info.foreground=event.foreground===true;
      window.dispatchEvent(new Event('ai-theatre-native-visibility'));return;
    }
    if(event.type==='voices'){voices=event.voices||[];if(synth.onvoiceschanged)synth.onvoiceschanged();return;}
    if(event.type.indexOf('recognition.')===0){
      var r=inputs.get(event.id);if(!r)return;
      var name=event.type.slice(12);
      if(name==='result'){
        var result={isFinal:event.isFinal===true,length:1,0:{transcript:event.text||'',confidence:0}};
        var results=r.finals.concat([result]);
        if(result.isFinal)r.finals.push(result);
        if(r.onresult)r.onresult({results:results,resultIndex:results.length-1});return;
      }
      if(name==='end'){inputs.delete(event.id);r.id=null;}
      var callback=r['on'+name];if(callback)callback(event);return;
    }
    if(event.type.indexOf('speech.')===0&&speech&&speech.id===event.id){
      var u=speech.utterance,kind=event.type.slice(7);
      if(kind==='start'){synth.pending=false;synth.speaking=true;if(u.onstart)u.onstart();}
      else {speech=null;synth.pending=false;synth.speaking=false;var callback=u[kind==='end'?'onend':'onerror'];if(callback)callback(event);}
    }
  };
  for(var pair of [['SpeechRecognition',Recognition],['webkitSpeechRecognition',Recognition],['SpeechSynthesisUtterance',Utterance],['speechSynthesis',synth]]){
    Object.defineProperty(window,pair[0],{configurable:true,value:pair[1]});
  }
  window.__AI_THEATRE_NATIVE_V1__ = info;
  window.dispatchEvent(new Event('ai-theatre-native-ready'));
  send({type:'hello'});
})`;

export const nativeBridgeBootstrap = (config: { platform: NativePlatform; appVersion: string }) =>
  `${BOOTSTRAP}(${JSON.stringify(config)});true;`;
