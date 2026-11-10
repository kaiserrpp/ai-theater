export type SpeechRecognitionStatus = 'unsupported' | 'idle' | 'suspended' | 'preparing' | 'finishing' | 'starting' | 'listening' | 'error';

type RecognitionResult = {
  readonly isFinal: boolean;
  [index: number]: { transcript: string } | undefined;
};

export type SpeechRecognitionHandle = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onaudioend: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string; message?: string }) => void) | null;
  onresult: ((event: { results: { readonly length: number; [index: number]: RecognitionResult | undefined } }) => void) | null;
  start: () => void;
  abort: () => void;
};

export type SpeechRecognitionConstructor = new () => SpeechRecognitionHandle;
export type SpeechRecognitionSnapshot = {
  status: SpeechRecognitionStatus;
  transcript: string;
  finalTranscript: string;
  interimTranscript: string;
  isAudioActive: boolean;
  hasReceivedTranscript: boolean;
  error: string | null;
  errorCode: string | null;
  errorDetail: string | null;
};

type RecognitionOptions = {
  naturalEnd?: boolean;
  pageVisible?: boolean;
  prepareRestart?: (callbacks: { onDone: () => void; onError: (error: Error) => void }) => () => void;
  usage?: { started: boolean };
};
const documentRecognitionUsage = { started: false };

const recognitionErrorMessage = (code?: string, detail = '') => {
  switch (code) {
    case 'not-allowed':
      if (detail.includes('Page is not visible')) {
        return 'La escucha se interrumpió porque la página no estaba visible. Vuelve a esta pestaña e inicia de nuevo el ensayo.';
      }
      if (detail.includes('Microphone permission check has failed')) {
        return 'Safari no tiene acceso al micrófono. Permite su uso para esta web y vuelve a iniciar el ensayo.';
      }
      return 'El navegador no ha autorizado el inicio del reconocimiento de voz. Puedes reintentarlo desde aquí.';
    case 'service-not-allowed':
      return detail.includes('not available')
        ? 'El servicio de reconocimiento de voz no está disponible en este momento. Puedes volver a intentarlo o ensayar sin reconocimiento.'
        : 'No se ha podido acceder al servicio de reconocimiento de voz. Puedes volver a intentarlo o ensayar sin reconocimiento.';
    case 'audio-capture':
      return 'No se puede usar el micrófono. Comprueba que esté disponible y pulsa Activar micrófono.';
    case 'network':
      return 'El servicio de reconocimiento no responde. Comprueba la conexión y pulsa Activar micrófono.';
    case 'language-not-supported':
      return 'El navegador no puede reconocer el idioma de esta réplica.';
    default:
      return 'No se pudo iniciar la escucha. Pulsa Activar micrófono para intentarlo de nuevo.';
  }
};

// Owns the browser service independently of React renders. A failed start stays
// blocked until an explicit tap; an `end` event must not erase the error.
export const createSpeechRecognitionSession = (
  Constructor: SpeechRecognitionConstructor | null,
  onChange: (snapshot: SpeechRecognitionSnapshot) => void,
  options: RecognitionOptions = {}
) => {
  let snapshot: SpeechRecognitionSnapshot = {
    status: Constructor ? 'idle' : 'unsupported', transcript: '', finalTranscript: '',
    interimTranscript: '', isAudioActive: false, hasReceivedTranscript: false, error: null, errorCode: null, errorDetail: null,
  };
  let recognition: SpeechRecognitionHandle | null = null;
  let enabled = false;
  let pageVisible = options.pageVisible ?? true;
  let blocked = false;
  let language = 'es-ES';
  let lineKey: string | null = null;
  let committedTranscript = '';
  let ignoredResultCount = 0;
  let latestResults: { readonly length: number; [index: number]: RecognitionResult | undefined } = { length: 0 };
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  let evidenceTimer: ReturnType<typeof setTimeout> | null = null;
  const usage = options.usage || documentRecognitionUsage;
  let needsCue = Boolean(options.naturalEnd && usage.started);
  let closingForChange = false;
  let preparing = false;
  let preparationVersion = 0;
  let cancelPreparation: (() => void) | null = null;
  const endWaiters = new Set<(ended: boolean) => void>();

  const update = (change: Partial<SpeechRecognitionSnapshot>) => {
    snapshot = { ...snapshot, ...change };
    onChange(snapshot);
  };
  const clearTimers = () => {
    if (restartTimer !== null) clearTimeout(restartTimer);
    if (startTimer !== null) clearTimeout(startTimer);
    restartTimer = null;
    startTimer = null;
  };
  const cancelCue = () => {
    preparationVersion += 1; preparing = false;
    const cancel = cancelPreparation; cancelPreparation = null; cancel?.();
  };
  const clearEvidence = () => {
    if (evidenceTimer !== null) clearTimeout(evidenceTimer);
    evidenceTimer = null;
  };
  const finishWaiters = () => { [...endWaiters].forEach((finish) => finish(true)); };
  const detach = (abort = true) => {
    clearTimers();
    const previous = recognition;
    recognition = null;
    if (!previous) return;
    previous.onstart = previous.onaudiostart = previous.onaudioend = previous.onend = null;
    previous.onerror = previous.onresult = null;
    if (abort) { try { previous.abort(); } catch { /* Already stopped. */ } }
    finishWaiters();
  };
  const fail = (message: string, code: string | null = null, detail: string | null = null) => {
    blocked = true;
    clearEvidence(); cancelCue();
    if (options.naturalEnd && recognition) {
      clearTimers(); closingForChange = true;
    } else detach();
    update({ status: 'error', isAudioActive: false, error: message, errorCode: code, errorDetail: detail });
  };
  const resetTranscript = () => {
    committedTranscript = '';
    ignoredResultCount = latestResults.length;
    update({ transcript: '', finalTranscript: '', interimTranscript: '', hasReceivedTranscript: false });
  };
  const armEvidence = () => {
    if (!options.naturalEnd || evidenceTimer !== null || !enabled || !pageVisible || blocked) return;
    evidenceTimer = setTimeout(() => {
      evidenceTimer = null;
      fail('Safari ha abierto la escucha, pero no ha entregado palabras. Pulsa Reintentar escucha y di «prueba de micro».', 'no-recognition-results');
    }, 20000);
  };
  const suspendForPageHide = () => {
    pageVisible = false;
    clearTimers(); clearEvidence(); cancelCue();
    committedTranscript = snapshot.transcript;
    closingForChange = true;
    update({ status: blocked ? 'error' : 'suspended', isAudioActive: false });
  };
  const start = () => {
    if (!Constructor || !enabled || !pageVisible || blocked || recognition || preparing) return;
    if (options.naturalEnd && needsCue && options.prepareRestart) {
      const version = ++preparationVersion;
      preparing = true;
      update({ status: 'preparing', isAudioActive: false });
      const cancel = options.prepareRestart({
        onDone: () => {
          if (version !== preparationVersion || !enabled || !pageVisible || blocked) return;
          preparing = false; cancelPreparation = null; needsCue = false; start();
        },
        onError: (error) => {
          if (version !== preparationVersion || !enabled) return;
          fail('No se pudo preparar la escucha. Pulsa Reintentar escucha.', 'recognition-cue-error', error.message);
        },
      });
      if (preparing && version === preparationVersion) cancelPreparation = cancel;
      return;
    }
    clearTimers();
    armEvidence();
    ignoredResultCount = 0;
    latestResults = { length: 0 };
    let current: SpeechRecognitionHandle;
    try {
      current = new Constructor();
      recognition = current;
      current.continuous = !options.naturalEnd;
      current.interimResults = true;
      current.lang = language;
      current.maxAlternatives = 1;
      let hadAudioInput = false;
      closingForChange = false;
      update({ status: 'starting', isAudioActive: false, hasReceivedTranscript: false, error: null, errorCode: null, errorDetail: null });
      current.onstart = () => {
        if (recognition === current && enabled && pageVisible && !blocked && !closingForChange) update({ status: 'listening' });
      };
      current.onaudiostart = () => {
        if (recognition !== current || !enabled || !pageVisible || blocked || closingForChange) return;
        hadAudioInput = true;
        if (startTimer !== null) clearTimeout(startTimer);
        startTimer = null;
        update({ status: 'listening', isAudioActive: true, error: null });
      };
      current.onaudioend = () => {
        if (recognition === current) update({ isAudioActive: false });
      };
      current.onerror = (event) => {
        if (recognition !== current) return;
        if (!pageVisible || /page.*(not visible|no longer visible|became invisible)/i.test(event.message ?? '')) {
          // WebKit stops capture when the page is hidden. This is a lifecycle
          // interruption, not a revoked microphone permission. Some versions
          // report only error, without the matching end event.
          if (pageVisible) suspendForPageHide();
          detach(false); closingForChange = false; needsCue = true;
          return;
        }
        if (!enabled || closingForChange || event.error === 'no-speech') return;
        fail(recognitionErrorMessage(event.error, event.message), event.error ?? null, event.message?.trim() || null);
      };
      current.onresult = (event) => {
        if (recognition !== current || !enabled || !pageVisible || blocked || closingForChange) return;
        hadAudioInput = true;
        if (startTimer !== null) clearTimeout(startTimer);
        startTimer = null;
        latestResults = event.results;
        const finals: string[] = [];
        const interims: string[] = [];
        const all: string[] = [];
        for (let index = ignoredResultCount; index < event.results.length; index += 1) {
          const result = event.results[index];
          const text = result?.[0]?.transcript?.trim();
          if (!text) continue;
          all.push(text);
          (result?.isFinal ? finals : interims).push(text);
        }
        if (all.length) clearEvidence();
        update({
          status: 'listening', isAudioActive: true, error: null,
          transcript: [committedTranscript, ...all].filter(Boolean).join(' '),
          finalTranscript: [committedTranscript, ...finals].filter(Boolean).join(' '),
          interimTranscript: interims.join(' '),
          hasReceivedTranscript: all.length > 0,
        });
      };
      current.onend = () => {
        if (recognition !== current) return;
        if (!pageVisible) {
          detach(false); closingForChange = false; needsCue = true;
          return;
        }
        if (options.naturalEnd) {
          // Calling abort() even after a normal end can poison later iOS runs.
          committedTranscript = snapshot.transcript;
          detach(false); closingForChange = false; needsCue = true;
          if (blocked) return;
          update({ status: Constructor ? 'idle' : 'unsupported', isAudioActive: false });
          if (enabled) restartTimer = setTimeout(() => { restartTimer = null; start(); }, 250);
          return;
        }
        if (!hadAudioInput) {
          fail('El reconocimiento terminó sin abrir el micrófono. Pulsa Activar micrófono para iniciar la escucha.');
          return;
        }
        committedTranscript = snapshot.transcript;
        detach(false);
        update({ status: Constructor ? 'idle' : 'unsupported', isAudioActive: false });
        if (enabled && !blocked) {
          restartTimer = setTimeout(() => { restartTimer = null; start(); }, 250);
        }
      };
      // Some devices expose the service but never open the audio input.
      startTimer = setTimeout(() => {
        if (recognition === current) fail('El reconocimiento no ha abierto el micrófono. Pulsa Activar micrófono para iniciar la escucha.');
      }, 15000);
      usage.started = true;
      current.start();
    } catch (error) {
      // A synchronous start failure never opened a native capture. Waiting for
      // its end event would leave every explicit retry stuck behind that handle.
      if (options.naturalEnd) detach(false);
      const code = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
      const detail = error instanceof Error ? error.message : '';
      fail(recognitionErrorMessage(code === 'NotAllowedError' ? 'not-allowed' : undefined, detail), code || null, detail || null);
    }
  };
  const stop = () => {
    enabled = false;
    clearEvidence(); cancelCue();
    if (options.naturalEnd && recognition) {
      clearTimers(); closingForChange = true;
      update({ status: blocked ? 'error' : pageVisible ? 'finishing' : 'suspended' });
      return;
    }
    detach();
    update({ status: blocked ? 'error' : !pageVisible ? 'suspended' : Constructor ? 'idle' : 'unsupported', isAudioActive: false });
  };
  return {
    getSnapshot: () => snapshot,
    setPageVisible: (visible: boolean) => {
      if (pageVisible === visible) return;
      if (!visible) { suspendForPageHide(); return; }
      pageVisible = visible;
      clearTimers(); clearEvidence(); cancelCue();
      committedTranscript = snapshot.transcript;
      // The browser owns the interruption on hide. Detach its obsolete handle
      // without calling abort/stop, even if it omitted the terminal callbacks.
      // Late events must never mutate the new foreground session.
      detach(false); closingForChange = false;
      needsCue = Boolean(options.naturalEnd && usage.started);
      if (!blocked) {
        update({ status: Constructor ? 'idle' : 'unsupported', isAudioActive: false });
        start();
      }
    },
    // The ordinary Start button can open the real recognizer immediately.
    // Volume calibration is not evidence that this separate service works.
    activate: (next: { lang: string; lineKey: string }) => {
      cancelCue(); clearEvidence();
      if (!options.naturalEnd) detach();
      enabled = true;
      blocked = false;
      language = next.lang;
      lineKey = next.lineKey;
      latestResults = { length: 0 };
      resetTranscript();
      armEvidence();
      if (options.naturalEnd && recognition) {
        closingForChange = true; needsCue = true; update({ status: 'finishing' }); return;
      }
      start();
    },
    configure: (next: { enabled: boolean; lang: string; lineKey: string | null }) => {
      const languageChanged = language !== next.lang;
      const lineChanged = lineKey !== next.lineKey;
      language = next.lang;
      lineKey = next.lineKey;
      // Discard a pending partial result from the previous cue. Otherwise its
      // result index can hide the first words of the actor's next turn.
      const hadPartialResult = Array.from({ length: latestResults.length }, (_, index) => latestResults[index])
        .some((result) => result && !result.isFinal);
      if (lineChanged) { resetTranscript(); clearEvidence(); }
      if (!next.enabled || !next.lineKey) { stop(); return; }
      enabled = true;
      armEvidence();
      if (languageChanged || (lineChanged && hadPartialResult)) {
        if (options.naturalEnd && recognition) {
          closingForChange = true; update({ status: 'finishing' }); return;
        }
        detach();
      }
      start();
    },
    // Called directly in the tap handler, before any promise or timer, so the
    // browser can associate recognition.start() with that user interaction.
    restart: () => {
      if (!enabled) return;
      blocked = false;
      cancelCue(); clearEvidence();
      if (options.naturalEnd && recognition) {
        closingForChange = true; needsCue = true;
        resetTranscript(); armEvidence(); update({ status: 'finishing' }); return;
      }
      detach();
      latestResults = { length: 0 };
      resetTranscript();
      armEvidence();
      start();
    },
    resetTranscript,
    stop,
    waitForEnd: () => {
      if (!recognition) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const finish = (ended: boolean) => { clearTimeout(timeout); endWaiters.delete(finish); resolve(ended); };
        const timeout = setTimeout(() => finish(false), 12000);
        endWaiters.add(finish);
      });
    },
    notifyPlaybackEnd: () => { if (!recognition) needsCue = false; },
    dispose: () => { enabled = false; clearEvidence(); cancelCue(); detach(); },
  };
};
