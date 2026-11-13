import type { LocalRecognizer } from './localSpeechRecognitionSession';
import type { ScriptRecognitionContext } from './scriptRecognitionContext';
import type { RecognitionProcessingTiming } from '../types/sharedScript';

export type ComparisonEngine = 'native' | 'vosk' | 'whisper';
export type ComparisonEngineResult = {
  engine: ComparisonEngine;
  text: string;
  status: 'listening' | 'done' | 'error' | 'timeout' | 'incomplete' | 'interrupted';
  error: string | null;
  firstTextMs: number | null;
  finalTextMs: number | null;
  finishedMs: number | null;
  timing: RecognitionProcessingTiming | null;
};
export type RehearsalComparisonTurn = { key: string; id: string; lang: string; context: ScriptRecognitionContext };
export type RehearsalComparisonResult = {
  turn: RehearsalComparisonTurn;
  completion: 'speech_end' | 'button' | 'manual' | 'exit' | 'capture_failed' | 'report_snapshot';
  elapsedMs: number;
  quietMs: number;
  speechStartMs: number | null;
  speechEndMs: number | null;
  inputClosedMs: number | null;
  speechTimingSource: 'shared_capture_rms' | 'native_result_event';
  sameUtterance: true;
  execution: 'parallel';
  results: ComparisonEngineResult[];
};
export type ComparisonSnapshot = { phase: 'idle' | 'preparing' | 'listening' | 'finishing' | 'paused' | 'complete' | 'error'; results: ComparisonEngineResult[]; message: string };
export type ComparisonCapture = { sampleRate: number; close: () => void };
export type ComparisonNative = { finish: () => void; closed: Promise<void>; abandon: () => void };
type Callbacks = { partial: (text: string) => void; final: (text: string) => void; finished: () => void;
  error: (message: string) => void; timing: (value: RecognitionProcessingTiming) => void };
type Dependencies = {
  prepare: () => Promise<Partial<Record<'vosk' | 'whisper', string>>>;
  openCapture: (frame: (buffer: AudioBuffer) => void, error: (message: string) => void, isCurrent: () => boolean) => Promise<ComparisonCapture>;
  createDecoder: (engine: 'vosk' | 'whisper', rate: number, turn: RehearsalComparisonTurn, callbacks: Callbacks) => Promise<LocalRecognizer>;
  openNative: (lang: string, callbacks: { ready: () => void; text: (text: string, final: boolean) => void; speech: () => void; ended: () => void; error: (message: string) => void }) => ComparisonNative;
  prepareNative: () => Promise<void>;
  cancelPreparation?: () => void;
  speechThreshold: () => number;
  onChange: (snapshot: ComparisonSnapshot) => void;
  onResult: (result: RehearsalComparisonResult) => void;
  now?: () => number;
};

const engines: ComparisonEngine[] = ['native', 'vosk', 'whisper'];
export const createRehearsalComparisonSession = (deps: Dependencies) => {
  const now = deps.now || (() => performance.now());
  let turn: RehearsalComparisonTurn | null = null, phase: ComparisonSnapshot['phase'] = 'idle';
  let values: ComparisonEngineResult[] = [], capture: ComparisonCapture | null = null, native: ComparisonNative | null = null;
  let decoders: Partial<Record<'vosk' | 'whisper', LocalRecognizer>> = {};
  let started = 0, hasSpeech = false, reported = false, finishing = false, suspended = false, disposed = false;
  let operation = 0, nativeEnded = true, nativeTextPrefix = '', nativeSegment = '', localReady = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null, finishTimer: ReturnType<typeof setTimeout> | null = null;
  let completion: RehearsalComparisonResult['completion'] = 'speech_end';
  let prepared: ReturnType<Dependencies['prepare']> | null = null;
  let speechStartMs: number | null = null, speechEndMs: number | null = null, inputClosedMs: number | null = null;
  let speechTimingSource: RehearsalComparisonResult['speechTimingSource'] = 'shared_capture_rms';
  let finalTexts: Partial<Record<ComparisonEngine, string>> = {};
  let captureRequest: Promise<ComparisonCapture> | null = null;
  let reportSnapshotNumber = 0;
  const reportWaiters = new Set<() => void>();
  const waitForReport = () => reported ? Promise.resolve() : new Promise<void>(resolve => reportWaiters.add(resolve));
  const snapshot = (message: string) => deps.onChange({ phase, results: values.map(value => ({ ...value })), message });
  const value = (engine: ComparisonEngine) => values.find(item => item.engine === engine)!;
  const clearQuiet = () => { if (quietTimer !== null) clearTimeout(quietTimer); quietTimer = null; };
  const closeCapture = () => { localReady = false; capture?.close(); capture = null; clearQuiet(); };
  const closeDecoders = () => { Object.values(decoders).forEach(decoder => decoder?.remove()); decoders = {}; };
  const maybeReport = () => {
    if (!turn || reported || !finishing || values.some(item => item.status === 'listening')) return;
    reported = true; phase = completion === 'capture_failed' ? 'error' : 'complete';
    if (finishTimer !== null) clearTimeout(finishTimer); finishTimer = null;
    closeDecoders(); snapshot(completion === 'capture_failed' ? 'No se ha podido captar voz. Puedes reintentar o pasar esta réplica.' : 'Tres resultados guardados.');
    deps.onResult({ turn, completion, elapsedMs: Math.round(now() - started), quietMs: 2000,
      speechStartMs, speechEndMs, inputClosedMs, speechTimingSource,
      sameUtterance: true, execution: 'parallel', results: values.map(item => ({ ...item })) });
    reportWaiters.forEach(resolve => resolve()); reportWaiters.clear();
  };
  const fail = (engine: ComparisonEngine, message: string) => {
    if (disposed || reported) return;
    Object.assign(value(engine), { status: 'error', error: message });
    snapshot(message); maybeReport();
  };
  const setText = (engine: ComparisonEngine, text: string, final: boolean) => {
    if (disposed || reported) return;
    const item = value(engine), nextText = text.trim();
    if (!final && item.text === nextText) return;
    item.text = nextText;
    if (item.text && item.firstTextMs === null) item.firstTextMs = Math.round(now() - started);
    if (final && nextText && finalTexts[engine] !== nextText) { item.finalTextMs = Math.round(now() - started); finalTexts[engine] = nextText; }
    snapshot(finishing ? 'Terminando las tres transcripciones…' : hasSpeech ? 'Comparativa: escuchando tu réplica.' : 'Comparativa: di tu réplica una vez. Dos segundos sin voz cierran esta toma.');
  };
  const finish = (reason: RehearsalComparisonResult['completion'] = 'manual') => {
    if (!turn || reported || finishing) return;
    operation++; finishing = true; suspended = false; completion = reason; phase = 'finishing';
    inputClosedMs = Math.round(now() - started);
    deps.cancelPreparation?.();
    closeCapture(); snapshot('Terminando las tres transcripciones, sin exigir coincidencia…');
    finishTimer = setTimeout(() => {
      for (const item of values) if (item.status === 'listening') Object.assign(item, { status: 'timeout', error: 'No terminó en los 10 s posteriores al cierre de la toma.' });
      maybeReport();
    }, 10000);
    native?.finish();
    for (const engine of ['vosk', 'whisper'] as const) {
      if (value(engine).status !== 'listening') continue;
      if (!decoders[engine]?.finishInput?.()) Object.assign(value(engine), { status: 'error', error: 'El motor no ha podido finalizar esta toma.' });
    }
    if (nativeEnded && value('native').status === 'listening') value('native').status = 'done';
    // Failed or silent decoders must not hold every following actor line.
    // The separate native.closed promise still guards TTS/new microphone use.
    maybeReport();
  };
  const voice = () => {
    if (disposed || reported || finishing || suspended) return;
    hasSpeech = true; clearQuiet();
    speechStartMs ??= Math.round(now() - started); speechEndMs = Math.round(now() - started);
    if (!capture) speechTimingSource = 'native_result_event';
    // Only the explicit comparison mode uses an acoustic take boundary. Normal
    // Intelligent rehearsal retains its word-based advancement and pauses.
    quietTimer = setTimeout(() => finish('speech_end'), 2000);
  };
  const frame = (buffer: AudioBuffer) => {
    if (!localReady || suspended || finishing || disposed) return;
    const data = buffer.getChannelData(0); let energy = 0;
    for (const sample of data) energy += sample * sample;
    if (Math.sqrt(energy / Math.max(1, data.length)) >= deps.speechThreshold()) {
      if (nativeEnded && hasSpeech && value('native').status === 'done') {
        Object.assign(value('native'), { status: 'incomplete', error: 'Safari cerró su escucha antes de que terminara la voz de esta toma.' });
      }
      voice();
    }
    for (const engine of ['vosk', 'whisper'] as const) {
      if (value(engine).status !== 'listening') continue;
      try { decoders[engine]?.acceptWaveform(buffer); } catch (error) { fail(engine, error instanceof Error ? error.message : 'Error procesando audio.'); }
    }
  };
  const open = async (next: RehearsalComparisonTurn) => {
    if (disposed) return;
    if (turn?.key === next.key && !reported && !suspended && (capture || phase === 'preparing')) return;
    if (turn?.key !== next.key && turn && !reported) finish('manual');
    const run = ++operation;
    if (turn?.key !== next.key || reported) {
      if (turn && !reported) await waitForReport();
      await native?.closed;
      await captureRequest?.catch(() => {});
      if (disposed || operation !== run) return;
      closeDecoders();
      turn = next; values = engines.map(engine => ({ engine, text: '', status: 'listening', error: null, firstTextMs: null, finalTextMs: null, finishedMs: null, timing: null }));
      speechStartMs = speechEndMs = inputClosedMs = null; finalTexts = {}; speechTimingSource = 'shared_capture_rms';
      nativeTextPrefix = nativeSegment = ''; hasSpeech = finishing = reported = false; started = now();
    } else {
      await native?.closed;
      await captureRequest?.catch(() => {});
      if (disposed || operation !== run) return;
      next = turn;
      nativeTextPrefix = value('native').text; nativeSegment = '';
      if (value('native').status !== 'error') value('native').status = 'listening';
    }
    suspended = false; phase = 'preparing';
    snapshot('Preparando Safari, Vosk y Whisper para esta réplica…');
    const valid = () => !disposed && operation === run && !suspended && !finishing && !reported;
    const preparationErrors = await (prepared ??= deps.prepare());
    if (!valid()) return;
    for (const engine of ['vosk', 'whisper'] as const) if (preparationErrors[engine]) fail(engine, preparationErrors[engine]!);
    await deps.prepareNative(); if (!valid()) return;
    try {
      const request = deps.openCapture(frame, message => {
        if (!valid()) return;
        fail('vosk', message); fail('whisper', message); closeCapture();
      }, valid);
      captureRequest = request;
      let opened: ComparisonCapture;
      try { opened = await request; } finally { if (captureRequest === request) captureRequest = null; }
      if (!valid()) { opened.close(); return; }
      capture = opened;
      await Promise.all((['vosk', 'whisper'] as const).map(async engine => {
        if (value(engine).status !== 'listening' || decoders[engine]) return;
        const finals: string[] = [];
        try {
          const decoder = await deps.createDecoder(engine, opened.sampleRate, next, {
            partial: text => { if (!disposed && turn?.id === next.id && !reported) setText(engine, [...finals, text].filter(Boolean).join(' '), false); },
            final: text => { if (!disposed && turn?.id === next.id && !reported) { if (text.trim()) finals.push(text.trim()); setText(engine, finals.join(' '), true); } },
            finished: () => { if (!disposed && turn?.id === next.id && !reported) { value(engine).status = 'done'; value(engine).finishedMs = Math.round(now() - started); maybeReport(); } },
            error: message => { if (turn?.id === next.id) fail(engine, message); },
            timing: timing => { if (turn?.id === next.id && !reported) value(engine).timing = timing; },
          });
          if (!valid()) { decoder.remove(); return; }
          decoders[engine] = decoder;
        } catch (error) { if (valid()) fail(engine, error instanceof Error ? error.message : 'No se pudo preparar el motor.'); }
      }));
      if (!valid()) { closeCapture(); return; }
    } catch (error) {
      if (!valid()) return;
      const message = error instanceof Error ? error.message : 'No se pudo abrir la captura compartida.';
      fail('vosk', message); fail('whisper', message);
    }
    if (!valid()) return;
    nativeEnded = false;
    let nativeReady = false;
    const ready = () => {
      if (!valid() || nativeReady) return;
      nativeReady = true;
      if (!hasSpeech && values.every(item => item.firstTextMs === null)) started = now();
      localReady = Boolean(capture); phase = 'listening'; snapshot('Comparativa: di tu réplica una vez. Dos segundos sin voz cierran esta toma.');
    };
    native = deps.openNative(next.lang, {
      ready,
      text: (text, final) => { if (!disposed && turn?.id === next.id && !reported) { nativeSegment = text; setText('native', [nativeTextPrefix, nativeSegment].filter(Boolean).join(' '), final); if (text.trim() && !capture) voice(); } },
      speech: voice,
      error: message => { if (turn?.id === next.id) fail('native', message); },
      ended: () => {
        if (turn?.id !== next.id || disposed) return;
        nativeEnded = true;
        value('native').finishedMs = Math.round(now() - started);
        if (value('native').status === 'listening') {
          value('native').status = 'done';
          if (value('native').text && finalTexts.native !== value('native').text) value('native').finalTextMs = Math.round(now() - started);
        }
        if (!capture && !finishing && !suspended) finish(hasSpeech ? 'speech_end' : 'capture_failed');
        maybeReport();
      },
    });
    if (nativeEnded) ready();
    if (values.every(item => item.status === 'error') && !hasSpeech) finish('capture_failed');
  };
  return {
    open, finish,
    snapshotForReport: (): RehearsalComparisonResult | null => !turn || reported || disposed ? null : ({
      turn: { ...turn, id: `${turn.id}-snapshot-${++reportSnapshotNumber}` }, completion: 'report_snapshot',
      elapsedMs: Math.round(now() - started), quietMs: 2000, speechStartMs, speechEndMs, inputClosedMs, speechTimingSource,
      sameUtterance: true, execution: 'parallel',
      results: values.map(item => ({ ...item, status: item.status === 'listening' ? 'incomplete' : item.status })),
    }),
    suspend: () => { if (!turn || reported || finishing) return; operation++; suspended = true; phase = 'paused'; deps.cancelPreparation?.(); closeCapture(); native?.finish(); snapshot('Comparativa en pausa. Conservamos las palabras de esta réplica.'); },
    waitForEnd: async () => {
      return new Promise<boolean>(resolve => { const timer = setTimeout(() => resolve(false), 12000);
        void Promise.all([native?.closed || Promise.resolve(), captureRequest?.catch(() => {}) || Promise.resolve(),
          finishing && !reported ? waitForReport() : Promise.resolve()]).then(() => { clearTimeout(timer); resolve(true); }); });
    },
    abandonNativeOnHide: () => { native?.abandon(); nativeEnded = true; },
    dispose: () => {
      if (turn && !reported) {
        finishing = true; completion = 'exit';
        for (const item of values) if (item.status === 'listening') Object.assign(item, { status: 'interrupted', error: 'Salida antes de terminar esta toma.' });
        maybeReport();
      }
      disposed = true; operation++; closeCapture(); closeDecoders(); native?.finish(); if (finishTimer !== null) clearTimeout(finishTimer);
    },
  };
};
