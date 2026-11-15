import type { NativePlatform } from './protocol';

// Literal source is intentional: Hermes does not preserve function.toString()
// as executable source. This runs before the existing web application loads.
const BOOTSTRAP = String.raw`(function(config) {
  if (window.__AI_THEATRE_NATIVE_V1__) return;
  var info = { protocol: 1, platform: config.platform, appVersion: config.appVersion, foreground: true, nativeLevelInput: config.platform==='android'&&config.nativeLevelInput===true, recognitionHints:config.recognitionHints===true };
  // A WebView navigation creates another JS world while the native host can
  // still be closing the previous world's input/output. Never reuse its IDs.
  var pageId = Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
  var count = 0, inputs = new Map(), meters = new Map(), speech = null, voices = [];
  function send(data) { window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({channel:'ai-theatre-native',protocol:1},data))); }
  if(info.nativeLevelInput)window.__AI_THEATRE_NATIVE_LEVEL_INPUT__={open:function(onLevel,onError){
    var item={id:'m-'+pageId+'-'+(++count),started:false,ending:false,onLevel:onLevel,onError:onError};
    item.ready=new Promise(function(resolve,reject){item.resolveReady=resolve;item.rejectReady=reject;});
    item.closed=new Promise(function(resolve){item.resolveClosed=resolve;});
    item.stop=function(){if(!item.ending){item.ending=true;send({type:'microphone.stop',id:item.id});}return item.closed;};
    meters.set(item.id,item);send({type:'microphone.start',id:item.id});return item;
  }};
  class Recognition {
    constructor() { this.lang='es-ES';this.continuous=false;this.interimResults=true;this.maxAlternatives=1;this.id=null;this.finals=[];this.ending=false; }
    start() {
      if(this.id) throw new Error('Recognition already started');
      this.id='r-'+pageId+'-'+(++count);this.finals=[];this.ending=false;inputs.set(this.id,this);
      var request={type:'recognition.start',id:this.id,lang:this.lang,continuous:this.continuous};
      if(info.recognitionHints&&this.recognitionHints)request.hints=this.recognitionHints;
      send(request);
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
      speech={id:'s-'+pageId+'-'+(++count),utterance:utterance};this.pending=true;
      send({type:'speech.start',id:speech.id,text:utterance.text,lang:utterance.lang,rate:utterance.rate,pitch:utterance.pitch,volume:utterance.volume,voice:utterance.voice&&utterance.voice.id});
    }
  };
  window.__AI_THEATRE_NATIVE_RECEIVE__=function(event){
    if(event.type.indexOf('microphone.')===0){
      var m=meters.get(event.id);if(!m)return;
      if(event.type==='microphone.start'){m.started=true;m.resolveReady();}
      else if(event.type==='microphone.level'){if(!m.ending&&typeof event.level==='number'&&isFinite(event.level))m.onLevel(Math.max(0,Math.min(1,event.level)));}
      else if(event.type==='microphone.error'){
        var cause=new Error(event.message||'Falló la captura nativa del micrófono.');cause.name=event.error==='not-allowed'?'NotAllowedError':'NativeCaptureError';
        if(!m.started)m.rejectReady(cause);else if(m.onError)m.onError(cause);
      }else if(event.type==='microphone.end'){
        meters.delete(event.id);m.resolveClosed();
        if(!m.started)m.rejectReady(new Error('microphone-input-cancelled'));
        else if(!m.ending&&m.onError)m.onError(new Error('La captura nativa ha terminado antes de cerrar la medición.'));
      }return;
    }
    if(event.type==='visibility'){
      info.foreground=event.foreground===true;
      window.dispatchEvent(new Event('ai-theatre-native-visibility'));return;
    }
    if(event.type==='voices'){voices=event.voices||[];if(synth.onvoiceschanged)synth.onvoiceschanged();return;}
    if(event.type.indexOf('recognition.')===0){
      var r=inputs.get(event.id);if(!r)return;
      var name=event.type.slice(12);
      if(name==='configuration'){if(r.onconfiguration)r.onconfiguration(event.recognitionInfo);return;}
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

export const nativeBridgeBootstrap = (config: { platform: NativePlatform; appVersion: string; nativeLevelInput?: boolean; recognitionHints?: boolean }) =>
  `${BOOTSTRAP}(${JSON.stringify(config)});true;`;
