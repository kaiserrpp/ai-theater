import { getAutomaticLineMatchReason, normalizeSpeechText, scoreLineMatch } from './lineMatching';
import { OpenAiRequestError, openAiVoiceConnection, type OpenAiVoiceConnection, type OpenAiVoiceEvent } from './openAiVoiceConnection';
import type { SpeechRecognitionConstructor, SpeechRecognitionHandle } from './speechRecognitionSession';

export const hasCompleteOpenAiLine = (expected: string, heard: string, variants: string[] = []) => {
  const match = scoreLineMatch(expected, heard, variants);
  if (!getAutomaticLineMatchReason(expected, heard, match) || match.negationPenaltyApplied) return false;
  const reference = normalizeSpeechText(match.referenceText || expected).split(/\s+/).filter(Boolean);
  const actual = normalizeSpeechText(heard).split(/\s+/).filter(Boolean);
  if (!reference.length || !actual.length) return false;
  if (actual.length < reference.length && actual.every((word, index) => word === reference[index])) return false;
  const length = Math.min(reference.length, reference.length > 6 ? 3 : 2);
  const ending = reference.slice(-length);
  const last = actual.slice(-length);
  if (last.length !== length) return false;
  if (ending.some((word, index) => word !== last[index])) {
    const tail = scoreLineMatch(ending.join(' '), last.join(' '));
    if (tail.score !== 1 || tail.finalScore !== 1 || tail.negationPenaltyApplied) return false;
  }
  const repeated = reference.slice(0, -length).some((_, index) =>
    ending.every((word, offset) => reference[index + offset] === word));
  return !repeated || match.coverageScore === 1 && actual.length >= reference.length;
};

export type OpenAiTurnTarget = { accepts: (text: string) => boolean; retryUnmatched?: boolean; minimumMs?: number };
type Link = {
  abort: AbortController;
  audio: AudioContext;
  output: MediaStreamAudioDestinationNode;
  connection?: OpenAiVoiceConnection;
  usedInput: boolean;
  retired: Set<string>;
  clearing?: { promise: Promise<void>; finish: (error?: Error) => void };
};
type Turn = {
  handle: SpeechRecognitionHandle;
  target: OpenAiTurnTarget;
  threshold: number;
  link?: Link;
  stream?: MediaStream;
  source?: MediaStreamAudioSourceNode;
  analyser?: AnalyserNode;
  levels?: Float32Array<ArrayBuffer>;
  phase: 'opening' | 'listening' | 'clearing' | 'confirming' | 'settled';
  frame?: number;
  resultTimer?: ReturnType<typeof setTimeout>;
  item?: string;
  text: string;
  lastVoice: number;
  lastWord: number;
  complete: boolean;
};

export const createOpenAiRehearsalRecognition = ({ getTarget, getThreshold, onUnauthorized, connect = openAiVoiceConnection }: {
  getTarget: (lineKey: string | null) => OpenAiTurnTarget;
  getThreshold: () => number | undefined;
  onUnauthorized: () => void;
  connect?: typeof openAiVoiceConnection;
}) => {
  let link: Link | undefined;
  let active: Turn | undefined;

  const disconnectInput = (turn: Turn) => {
    if (turn.frame !== undefined) cancelAnimationFrame(turn.frame);
    turn.frame = undefined;
    turn.source?.disconnect();
  };
  const releaseCapture = (turn: Turn) => {
    disconnectInput(turn);
    turn.analyser?.disconnect();
    const stream = turn.stream;
    turn.stream = undefined;
    turn.source = undefined;
    turn.analyser = undefined;
    stream?.getTracks().forEach(track => track.stop());
  };
  const retireItem = (turn: Turn) => {
    if (turn.item) turn.link?.retired.add(turn.item);
    turn.item = undefined;
  };
  const closeLink = () => {
    const previous = link;
    link = undefined;
    if (!previous) return;
    previous.clearing?.finish(new Error('Se cerró la conexión con OpenAI.'));
    previous.abort.abort();
    previous.connection?.close();
    previous.output.stream.getTracks().forEach(track => track.stop());
    void previous.audio.close().catch(() => {});
  };
  const end = (turn: Turn) => {
    if (active !== turn) return;
    active = undefined;
    clearTimeout(turn.resultTimer);
    retireItem(turn);
    releaseCapture(turn);
    if (link && turn.link === link && !link.connection) closeLink();
    turn.handle.onaudioend?.();
    turn.handle.onend?.();
  };
  const fail = (turn: Turn, error: unknown) => {
    if (active !== turn) return;
    closeLink();
    releaseCapture(turn);
    if (error instanceof OpenAiRequestError && error.status === 401) onUnauthorized();
    const denied = error instanceof Error && error.name === 'NotAllowedError';
    const message = denied ? 'Permite el micrófono para ensayar con OpenAI.'
      : error instanceof Error ? error.message : 'No se pudo iniciar la escucha de OpenAI.';
    turn.handle.onerror?.({ error: 'openai-recognition-failed', message });
    end(turn);
  };
  const emit = (turn: Turn, text: string, isFinal: boolean) => {
    turn.handle.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
  };

  const clearBuffer = (current: Link) => {
    if (current.clearing) return current.clearing.promise;
    if (!current.usedInput) return Promise.resolve();
    let finish!: (error?: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('OpenAI no confirmó que la escucha se hubiera reiniciado.')), 2000);
      finish = error => {
        clearTimeout(timer);
        current.clearing = undefined;
        if (error) reject(error);
        else { current.usedInput = false; resolve(); }
      };
    });
    current.clearing = { promise, finish };
    try { current.connection!.send('input_audio_buffer.clear'); }
    catch (error) { finish(error instanceof Error ? error : new Error('No se pudo reiniciar la escucha.')); }
    return promise;
  };
  const listen = (turn: Turn) => {
    turn.phase = 'listening';
    turn.text = '';
    turn.lastVoice = turn.lastWord = 0;
    turn.complete = false;
    turn.link!.usedInput = true;
    turn.source!.connect(turn.analyser!);
    turn.frame = requestAnimationFrame(() => monitor(turn));
  };
  const tryAgain = async (turn: Turn) => {
    turn.phase = 'clearing';
    retireItem(turn);
    disconnectInput(turn);
    try {
      await clearBuffer(turn.link!);
      if (active === turn) {
        emit(turn, '', false);
        listen(turn);
      }
    } catch (error) { fail(turn, error); }
  };
  const confirm = (turn: Turn) => {
    turn.phase = 'confirming';
    disconnectInput(turn);
    turn.resultTimer = setTimeout(() => fail(turn, new Error('OpenAI no confirmó el final de la réplica.')), 4500);
    try { turn.link!.connection!.send('input_audio_buffer.commit'); }
    catch (error) { fail(turn, error); }
  };
  const monitor = (turn: Turn) => {
    if (active !== turn || turn.phase !== 'listening') return;
    const now = performance.now();
    const levels = turn.levels!;
    turn.analyser!.getFloatTimeDomainData(levels);
    const meanSquare = levels.reduce((sum, value) => sum + value * value, 0) / levels.length;
    if (meanSquare > turn.threshold * turn.threshold) turn.lastVoice = now;
    const quietFor = now - Math.max(turn.lastVoice, turn.lastWord);
    if (turn.complete && quietFor >= 400) { confirm(turn); return; }
    if (turn.target.retryUnmatched && turn.text.trim() && quietFor >= 900) { void tryAgain(turn); return; }
    turn.frame = requestAnimationFrame(() => monitor(turn));
  };
  const handleEvent = (current: Link, event: OpenAiVoiceEvent) => {
    if (link !== current) return;
    if (event.type === 'input_audio_buffer.cleared') { current.clearing?.finish(); return; }
    const turn = active;
    if (!turn || turn.link !== current || turn.phase === 'settled') return;
    const item = event.item_id;
    if (item && (current.retired.has(item) || (turn.item && item !== turn.item))) return;
    if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') {
      fail(turn, new Error('OpenAI interrumpió la transcripción. Pulsa Activar micrófono para reintentar.'));
      return;
    }
    if (!item) return;
    if (event.type === 'conversation.item.input_audio_transcription.delta' && turn.phase === 'listening' && typeof event.delta === 'string') {
      turn.item = item;
      turn.text += event.delta;
      turn.lastWord = performance.now();
      turn.complete = turn.target.accepts(turn.text);
      emit(turn, turn.text, false);
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed' && turn.phase === 'confirming' && turn.item === item) {
      clearTimeout(turn.resultTimer);
      const final = typeof event.transcript === 'string' ? event.transcript.trim() : '';
      if (turn.target.retryUnmatched && !turn.target.accepts(final)) { void tryAgain(turn); return; }
      turn.phase = 'settled';
      retireItem(turn);
      releaseCapture(turn);
      turn.handle.onaudioend?.();
      emit(turn, final || turn.text, Boolean(final));
    }
  };
  const begin = async (turn: Turn) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      if (active !== turn) { stream.getTracks().forEach(track => track.stop()); return; }
      turn.stream = stream;
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState !== 'live') throw new Error('El micrófono no está disponible.');
      track.addEventListener('ended', () => {
        if (turn.stream === stream) fail(turn, new Error('El micrófono se ha cerrado.'));
      }, { once: true });

      const previous = link?.connection;
      if (previous && previous.remainingSeconds > 0 &&
          previous.deadline - performance.now() < (turn.target.minimumMs ?? 12_000)) closeLink();
      if (!link) {
        const audio = new AudioContext();
        const current: Link = { audio, output: audio.createMediaStreamDestination(), abort: new AbortController(),
          retired: new Set(), usedInput: false };
        link = turn.link = current;
        if (audio.state === 'suspended') await audio.resume();
        if (active !== turn) return;
        const connection = await connect({ output: current.output.stream, signal: current.abort.signal,
          onEvent: event => handleEvent(current, event),
          onDisconnect: message => {
            if (link !== current) return;
            const currentTurn = active;
            if (currentTurn?.link === current && currentTurn.phase !== 'settled') fail(currentTurn, new Error(message));
            else closeLink();
          },
        });
        if (link !== current) { connection.close(); return; }
        current.connection = connection;
      }
      if (active !== turn || !link) return;
      const current = turn.link = link;
      await clearBuffer(current);
      if (active !== turn || link !== current) return;
      turn.source = current.audio.createMediaStreamSource(stream);
      turn.analyser = current.audio.createAnalyser();
      turn.levels = new Float32Array(turn.analyser.fftSize);
      turn.analyser.connect(current.output);
      listen(turn);
      turn.handle.onstart?.();
      turn.handle.onaudiostart?.();
    } catch (error) { fail(turn, error); }
  };

  class OpenAiRecognition implements SpeechRecognitionHandle {
    static controlledInputEnd = true;
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

    constructor(private readonly lineKey: string | null = null) {}

    start() {
      if (active) end(active);
      const turn: Turn = { handle: this, target: getTarget(this.lineKey), threshold: getThreshold() ?? 0.017,
        phase: 'opening', text: '', lastVoice: 0, lastWord: 0, complete: false };
      active = turn;
      void begin(turn);
    }

    abort() {
      if (active?.handle === this) end(active);
    }
  }
  const Constructor: SpeechRecognitionConstructor = OpenAiRecognition;
  return { Constructor, close: () => { if (active) end(active); closeLink(); } };
};
