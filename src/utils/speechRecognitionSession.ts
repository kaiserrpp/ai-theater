export type SpeechRecognitionStatus = 'unsupported' | 'idle' | 'starting' | 'listening' | 'error';

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
  error: string | null;
};

const recognitionErrorMessage = (code?: string) => {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'El navegador ha bloqueado el reconocimiento de voz. Permite el micrófono en los ajustes de este sitio y pulsa Activar micrófono.';
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
  onChange: (snapshot: SpeechRecognitionSnapshot) => void
) => {
  let snapshot: SpeechRecognitionSnapshot = {
    status: Constructor ? 'idle' : 'unsupported', transcript: '', finalTranscript: '',
    interimTranscript: '', isAudioActive: false, error: null,
  };
  let recognition: SpeechRecognitionHandle | null = null;
  let enabled = false;
  let blocked = false;
  let language = 'es-ES';
  let lineKey: string | null = null;
  let committedTranscript = '';
  let ignoredResultCount = 0;
  let latestResults: { readonly length: number; [index: number]: RecognitionResult | undefined } = { length: 0 };
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;

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
  const detach = () => {
    clearTimers();
    const previous = recognition;
    recognition = null;
    if (!previous) return;
    previous.onstart = previous.onaudiostart = previous.onaudioend = previous.onend = null;
    previous.onerror = previous.onresult = null;
    try { previous.abort(); } catch { /* Already stopped. */ }
  };
  const fail = (message: string) => {
    blocked = true;
    detach();
    update({ status: 'error', isAudioActive: false, error: message });
  };
  const resetTranscript = () => {
    committedTranscript = '';
    ignoredResultCount = latestResults.length;
    update({ transcript: '', finalTranscript: '', interimTranscript: '' });
  };
  const start = () => {
    if (!Constructor || !enabled || blocked || recognition) return;
    clearTimers();
    ignoredResultCount = 0;
    latestResults = { length: 0 };
    let current: SpeechRecognitionHandle;
    try {
      current = new Constructor();
      recognition = current;
      current.continuous = true;
      current.interimResults = true;
      current.lang = language;
      current.maxAlternatives = 1;
      let hadAudioInput = false;
      update({ status: 'starting', isAudioActive: false, error: null });
      current.onstart = () => {
        if (recognition === current) update({ status: 'listening' });
      };
      current.onaudiostart = () => {
        if (recognition !== current) return;
        hadAudioInput = true;
        if (startTimer !== null) clearTimeout(startTimer);
        startTimer = null;
        update({ status: 'listening', isAudioActive: true, error: null });
      };
      current.onaudioend = () => {
        if (recognition === current) update({ isAudioActive: false });
      };
      current.onerror = (event) => {
        if (recognition !== current || event.error === 'no-speech') return;
        fail(recognitionErrorMessage(event.error));
      };
      current.onresult = (event) => {
        if (recognition !== current) return;
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
        update({
          status: 'listening', isAudioActive: true, error: null,
          transcript: [committedTranscript, ...all].filter(Boolean).join(' '),
          finalTranscript: [committedTranscript, ...finals].filter(Boolean).join(' '),
          interimTranscript: interims.join(' '),
        });
      };
      current.onend = () => {
        if (recognition !== current) return;
        if (!hadAudioInput) {
          fail('El reconocimiento terminó sin abrir el micrófono. Pulsa Activar micrófono para iniciar la escucha.');
          return;
        }
        committedTranscript = snapshot.transcript;
        detach();
        update({ status: Constructor ? 'idle' : 'unsupported', isAudioActive: false });
        if (enabled && !blocked) {
          restartTimer = setTimeout(() => { restartTimer = null; start(); }, 250);
        }
      };
      // Some devices expose the service but never open the audio input.
      startTimer = setTimeout(() => {
        if (recognition === current) fail('El reconocimiento no ha abierto el micrófono. Pulsa Activar micrófono para iniciar la escucha.');
      }, 15000);
      current.start();
    } catch (error) {
      const code = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
      fail(recognitionErrorMessage(code === 'NotAllowedError' ? 'not-allowed' : undefined));
    }
  };
  const stop = () => {
    enabled = false;
    detach();
    update({ status: blocked ? 'error' : Constructor ? 'idle' : 'unsupported', isAudioActive: false });
  };
  return {
    getSnapshot: () => snapshot,
    configure: (next: { enabled: boolean; lang: string; lineKey: string | null }) => {
      const languageChanged = language !== next.lang;
      const lineChanged = lineKey !== next.lineKey;
      language = next.lang;
      lineKey = next.lineKey;
      // Discard a pending partial result from the previous cue. Otherwise its
      // result index can hide the first words of the actor's next turn.
      const hadPartialResult = Array.from({ length: latestResults.length }, (_, index) => latestResults[index])
        .some((result) => result && !result.isFinal);
      if (lineChanged) resetTranscript();
      if (!next.enabled || !next.lineKey) { stop(); return; }
      enabled = true;
      if (languageChanged || (lineChanged && hadPartialResult)) detach();
      start();
    },
    // Called directly in the tap handler, before any promise or timer, so the
    // browser can associate recognition.start() with that user interaction.
    restart: () => {
      if (!enabled) return;
      blocked = false;
      detach();
      latestResults = { length: 0 };
      resetTranscript();
      start();
    },
    resetTranscript,
    stop,
    dispose: () => { enabled = false; detach(); },
  };
};
