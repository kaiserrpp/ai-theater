import type { BridgeCommand, BridgeEvent } from './protocol';

type Run = { id: string; cancelled: boolean; started: boolean; closing: boolean; audioEnded: boolean; closed: Promise<void>; resolve: () => void };
type SpeechOptions = { lang: string; rate: number; pitch: number; volume: number; voice?: string;
  onStart: () => void; onDone: () => void; onError: (message: string) => void };
type Dependencies = {
  emit: (event: BridgeEvent) => void;
  requestPermission: () => Promise<boolean>;
  isRecognitionAvailable: () => boolean;
  startRecognition: (options: { lang: string; continuous: boolean }) => void;
  abortRecognition: () => void;
  stopRecognition: () => void;
  speak: (text: string, options: SpeechOptions) => void;
  stopSpeech: () => Promise<void>;
  voices: () => Promise<NonNullable<BridgeEvent['voices']>>;
};

// This controller exclusively owns the installed app's native recognizer. Its
// explicit cancellation is unrelated to the unsafe WebKit stop/abort path.
export const createNativePrototypeController = (deps: Dependencies) => {
  let foreground = true, disposed = false;
  let input: Run | null = null, pendingInput: BridgeCommand | null = null;
  let pendingSpeech: BridgeCommand | null = null, speaking: string | null = null;
  let speechStop: Promise<void> = Promise.resolve();
  const emit = (event: BridgeEvent) => { if (!disposed) deps.emit(event); };
  const error = (id: string | undefined, message: string, kind = 'audio-capture') =>
    emit({ type: 'recognition.error', id, error: kind, message });
  const finishInput = (run: Run) => {
    if (input !== run) return;
    if (!run.audioEnded) emit({ type: 'recognition.audioend', id: run.id });
    input = null; run.resolve(); emit({ type: 'recognition.end', id: run.id });
  };
  const cancelInput = (run: Run, final = false) => {
    if (run.closing) {
      if (!final && !run.cancelled && run.started) { run.cancelled = true; deps.abortRecognition(); }
      return;
    }
    run.cancelled = !final; run.closing = true;
    if (!run.started) { finishInput(run); return; }
    try { if (final) deps.stopRecognition(); else deps.abortRecognition(); }
    catch (cause) { error(run.id, cause instanceof Error ? cause.message : 'No se pudo cerrar la entrada nativa.'); }
  };
  const waitClosed = async (run: Run) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([run.closed, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('El reconocedor nativo no ha confirmado el cierre de la entrada.')), 8000);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  };
  const cancelSpeech = () => {
    pendingSpeech = null;
    if (speaking) {
      const owner = speaking;
      speechStop = speechStop.catch(() => {}).then(() => deps.stopSpeech()).then(() => { if (speaking === owner) speaking = null; });
    }
    return speechStop;
  };
  const startInput = async (command: BridgeCommand) => {
    if (!command.id) return;
    pendingInput = command;
    try {
      await cancelSpeech();
      if (input) { const previous = input; cancelInput(previous); await waitClosed(previous); }
      if (pendingInput !== command || !foreground || disposed) return;
      let resolve: () => void = () => {};
      const run: Run = { id: command.id, cancelled: false, started: false, closing: false, audioEnded: false,
        closed: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
      input = run; pendingInput = null;
      const granted = await deps.requestPermission();
      if (input !== run || run.cancelled || !foreground || disposed) return;
      if (!granted) { error(run.id, 'Permite el micrófono y el reconocimiento de voz en los ajustes de esta app.', 'not-allowed'); finishInput(run); return; }
      if (!deps.isRecognitionAvailable()) { error(run.id, 'El reconocedor del teléfono no está disponible.', 'service-not-allowed'); finishInput(run); return; }
      run.started = true;
      try { deps.startRecognition({ lang: command.lang || 'es-ES', continuous: command.continuous === true }); }
      catch (cause) { error(run.id, cause instanceof Error ? cause.message : 'No se pudo iniciar la escucha.'); finishInput(run); }
    } catch (cause) {
      if (pendingInput === command) pendingInput = null;
      error(command.id, cause instanceof Error ? cause.message : 'No se pudo preparar la escucha.');
      if (input && input.id === command.id && !input.started) finishInput(input);
      else emit({ type: 'recognition.end', id: command.id });
    }
  };
  const startSpeech = async (command: BridgeCommand) => {
    const stopped = cancelSpeech(); pendingSpeech = command;
    try {
      await stopped;
      if (input) { const previous = input; cancelInput(previous); await waitClosed(previous); }
      if (pendingSpeech !== command || !foreground || disposed || !command.id) return;
      pendingSpeech = null; speaking = command.id;
      const id = command.id;
      const done = () => { if (speaking === id) { speaking = null; emit({ type: 'speech.end', id }); } };
      const bounded = (value: unknown, fallback: number, min: number, max: number) =>
        typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
      deps.speak(command.text || '', {
        lang: command.lang || 'es-ES', rate: bounded(command.rate, .96, .3, 2), pitch: bounded(command.pitch, 1, .5, 2),
        volume: bounded(command.volume, 1, 0, 1), voice: command.voice,
        onStart: () => { if (speaking === id) emit({ type: 'speech.start', id }); }, onDone: done,
        onError: message => { if (speaking === id) { speaking = null; emit({ type: 'speech.error', id, message }); } },
      });
    } catch (cause) {
      if (pendingSpeech === command) pendingSpeech = null;
      emit({ type: 'speech.error', id: command.id, message: cause instanceof Error ? cause.message : 'No se pudo reproducir la voz.' });
    }
  };
  return {
    handle: (command: BridgeCommand) => {
      if (disposed) return;
      if (command.type === 'hello') {
        emit({ type: 'visibility', foreground });
        void deps.voices().then(voices => emit({ type: 'voices', voices })).catch(() => {});
      } else if (command.type === 'recognition.start') void startInput(command);
      else if (command.type === 'recognition.abort' || command.type === 'recognition.stop') {
        if (pendingInput && pendingInput.id === command.id) { pendingInput = null; emit({ type: 'recognition.end', id: command.id }); }
        if (input && input.id === command.id) cancelInput(input, command.type === 'recognition.stop');
      } else if (command.type === 'speech.start') void startSpeech(command);
      else if (command.type === 'speech.cancel') void cancelSpeech().catch(() => {});
    },
    recognitionEvent: (type: string, data: { text?: string; isFinal?: boolean; error?: string; message?: string } = {}) => {
      if (!input || disposed) return;
      const run = input;
      if (type === 'audioend') run.audioEnded = true;
      if (type === 'end') { finishInput(run); return; }
      if (type === 'result' && run.cancelled) return;
      if (type === 'error' && run.cancelled && data.error === 'aborted') return;
      if (type === 'error' && data.error === 'speech-timeout') data = { ...data, error: 'no-speech' };
      emit({ type: `recognition.${type}`, id: run.id, ...data });
    },
    setForeground: (value: boolean) => {
      foreground = value; emit({ type: 'visibility', foreground });
      if (!value) {
        if (pendingInput) { emit({ type: 'recognition.end', id: pendingInput.id }); pendingInput = null; }
        if (input) cancelInput(input);
        void cancelSpeech().catch(() => {});
      }
    },
    dispose: () => {
      if (input) cancelInput(input);
      void cancelSpeech().catch(() => {}); pendingInput = null; disposed = true;
    },
  };
};
