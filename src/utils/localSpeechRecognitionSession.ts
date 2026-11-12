import type { SpeechRecognitionConstructor, SpeechRecognitionHandle } from './speechRecognitionSession';
import type { ScriptRecognitionContext } from './scriptRecognitionContext';

export type LocalRecognizer = {
  on: (event: 'result' | 'partialresult' | 'error', callback: (message: {
    result?: { text?: string; partial?: string }; error?: string;
  }) => void) => void;
  acceptWaveform: (buffer: AudioBuffer) => void;
  remove: () => void;
};
export type LocalSpeechModel = { KaldiRecognizer: new (sampleRate: number, getContext?: () => ScriptRecognitionContext | undefined) => LocalRecognizer };
type Dependencies = {
  loadModel: () => Promise<LocalSpeechModel>;
  getUserMedia: () => Promise<MediaStream>;
  createAudioContext: () => AudioContext;
  getContext?: () => ScriptRecognitionContext | undefined;
};

// The language model stays loaded across turns. Only our own capture graph and
// decoder are released; there is no Safari speech service to disconnect.
export const createLocalSpeechRecognitionConstructor = (dependencies: Dependencies): SpeechRecognitionConstructor => {
  return class LocalSpeechRecognition implements SpeechRecognitionHandle {
    continuous = true;
    interimResults = true;
    lang = 'es-ES';
    maxAlternatives = 1;
    onstart: SpeechRecognitionHandle['onstart'] = null;
    onaudiostart: SpeechRecognitionHandle['onaudiostart'] = null;
    onaudioend: SpeechRecognitionHandle['onaudioend'] = null;
    onspeechend: SpeechRecognitionHandle['onspeechend'] = null;
    onend: SpeechRecognitionHandle['onend'] = null;
    onerror: SpeechRecognitionHandle['onerror'] = null;
    onresult: SpeechRecognitionHandle['onresult'] = null;
    private generation = 0;
    private active = false;
    private stream: MediaStream | null = null;
    private context: AudioContext | null = null;
    private source: MediaStreamAudioSourceNode | null = null;
    private processor: ScriptProcessorNode | null = null;
    private output: GainNode | null = null;
    private recognizer: LocalRecognizer | null = null;
    private finals: string[] = [];

    private release() {
      this.generation += 1;
      this.active = false;
      if (this.processor) this.processor.onaudioprocess = null;
      this.source?.disconnect(); this.processor?.disconnect(); this.output?.disconnect();
      this.source = null; this.processor = null; this.output = null;
      this.stream?.getTracks().forEach((track) => track.stop());
      this.stream = null;
      this.recognizer?.remove(); this.recognizer = null;
      const context = this.context; this.context = null;
      if (context) void context.close().catch(() => undefined);
    }

    abort() {
      const wasActive = this.active;
      this.release();
      if (wasActive) { this.onaudioend?.(); this.onend?.(); }
    }

    start() {
      if (this.active) throw Object.assign(new Error('Recognition is already active'), { name: 'InvalidStateError' });
      this.active = true;
      const generation = ++this.generation;
      const isCurrent = () => this.active && this.generation === generation;
      this.finals = [];
      const emit = (partial = '') => {
        if (!isCurrent()) return;
        this.onresult?.({ results: [
          ...this.finals.map((text) => ({ isFinal: true, 0: { transcript: text } })),
          ...(partial ? [{ isFinal: false, 0: { transcript: partial } }] : []),
        ] });
      };
      // Request permission in start() itself, so the initial tap is preserved.
      const capture = dependencies.getUserMedia().then((stream) => {
        if (!isCurrent()) { stream.getTracks().forEach((track) => track.stop()); return null; }
        this.stream = stream;
        return stream;
      });
      void Promise.all([Promise.resolve().then(dependencies.loadModel), capture]).then(async ([model, stream]) => {
        if (!isCurrent() || !stream) return;
        const context = dependencies.createAudioContext();
        this.context = context;
        if (context.state === 'suspended') await context.resume();
        if (!isCurrent()) return;
        const recognizer = new model.KaldiRecognizer(context.sampleRate, dependencies.getContext);
        this.recognizer = recognizer;
        recognizer.on('partialresult', (message) => emit(message.result?.partial?.trim() || ''));
        recognizer.on('result', (message) => {
          if (!isCurrent()) return;
          const text = message.result?.text?.trim();
          if (text) this.finals.push(text);
          emit();
        });
        recognizer.on('error', (message) => {
          if (!isCurrent()) return;
          this.release();
          this.onerror?.({ error: 'local-recognition-failed', message: message.error || 'local-decoder-error' });
          this.onend?.();
        });
        this.source = context.createMediaStreamSource(stream);
        this.processor = context.createScriptProcessor(2048, 1, 1);
        this.output = context.createGain(); this.output.gain.value = 0;
        this.processor.onaudioprocess = (event) => {
          if (!isCurrent()) return;
          try { recognizer.acceptWaveform(event.inputBuffer); }
          catch (error) {
            this.release();
            this.onerror?.({ error: 'local-recognition-failed', message: error instanceof Error ? error.message : 'local-audio-processing-error' });
            this.onend?.();
          }
        };
        this.source.connect(this.processor); this.processor.connect(this.output);
        this.output.connect(context.destination);
        this.onstart?.(); this.onaudiostart?.();
      }).catch((error: unknown) => {
        if (!isCurrent()) return;
        this.release();
        const name = error instanceof Error ? error.name : '';
        this.onerror?.({ error: name === 'NotAllowedError' ? 'not-allowed' : 'local-recognition-failed',
          message: error instanceof Error ? error.message : 'No se pudo preparar el reconocimiento local.' });
        this.onend?.();
      });
    }
  };
};
