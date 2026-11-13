import { createDecisionTracker } from './comparison-timing.mjs';
import { evaluateTranscript } from './comparison-core.mjs';
import { needsNaturalRecognitionEnd } from './speechRecognitionCompatibility.mjs';

// Safari has no start(audioTrack) overload. Its own microphone take is kept
// separate from the identical PCM replay used by the two local engines.
export const createNativeComparison = ({ Constructor, device, now = () => performance.now(),
  onState = () => {}, onResult = () => {}, prepareContinuation = done => { done(); return () => {}; } }) => {
  const natural = needsNaturalRecognitionEnd(device);
  let current = null, tracker = null, committed = '', currentText = '', expected = '', language = 'spanish';
  let ongoing = false, ending = false, preparing = false, hasUsedNative = false, generation = 0, started = 0, opened = null;
  let speechEndMs = null, finishRequested = null, sessions = 0, error = null, cancelPreparation = null;
  let decisionInputEndMs = null, inputEndSignal = null, serviceEndMs = null, latestAudioEndMs = null;
  let timeout = null, limit = null, closeWarning = null;
  const clearTimers = () => { clearTimeout(timeout); clearTimeout(limit); clearTimeout(closeWarning); };
  const state = message => onState({ busy: ongoing, active: Boolean(current), ending, preparing,
    canContinue: ongoing && !current && !ending && !preparing, text: currentText, message });
  const ensureTracker = () => {
    if (!tracker) { opened = now(); tracker = createDecisionTracker({ expected, now }); }
  };
  const markInputEnd = signal => {
    if (opened !== null && signal === 'audioend') latestAudioEndMs = Math.round(now() - opened);
    const acceptedAt = tracker?.snapshot().acceptedAtMs;
    if (opened === null || acceptedAt == null || decisionInputEndMs !== null) return;
    decisionInputEndMs = Math.max(acceptedAt, latestAudioEndMs ?? Math.round(now() - opened));
    inputEndSignal = latestAudioEndMs === null ? signal : 'audioend';
  };
  const save = () => {
    if (!ongoing) return;
    clearTimers(); cancelPreparation?.(); cancelPreparation = null;
    const measured = tracker?.snapshot() || { firstTextMs: null, acceptedAtMs: null, decisionText: null, events: [] };
    const evaluation = evaluateTranscript(expected, currentText);
    const result = { engine: 'native', status: error ? 'error' : 'done', text: currentText,
      ...evaluation, finalAccepted: evaluation.accepted, accepted: measured.acceptedAtMs !== null,
      backend: 'browser', languageUsed: language === 'english' ? 'english' : 'spanish', loadMs: null, processingMs: null,
      contextUsed: false, timingKind: 'native_live', verdict: null, error,
      native: { ...measured, startMs: opened === null ? null : Math.round(opened - started),
        speechEndMs, speechEndKind: 'browser_speechend_event', sessions,
        inputEndMs: decisionInputEndMs, inputEndSignal, serviceEndMs,
        matchToInputEndMs: decisionInputEndMs === null || measured.acceptedAtMs === null ? null : decisionInputEndMs - measured.acceptedAtMs,
        decisionAfterSpeechMs: measured.acceptedAtMs === null || speechEndMs === null ? null : measured.acceptedAtMs - speechEndMs,
        endWaitMs: finishRequested === null ? 0 : Math.round(now() - finishRequested),
        durationMs: Math.round(now() - started) } };
    ongoing = ending = preparing = false; tracker?.dispose(); tracker = null;
    onResult(result); state(error || 'Toma de Safari guardada. Ahora graba la muestra para Vosk y Whisper.');
  };
  const begin = () => {
    if (!ongoing || ending || current) return;
    const run = generation;
    let recognition;
    try {
      recognition = new Constructor(); current = recognition;
      latestAudioEndMs = null;
      recognition.continuous = !natural; recognition.interimResults = true;
      recognition.lang = language === 'english' ? 'en-US' : 'es-ES'; recognition.maxAlternatives = 1;
      const valid = () => ongoing && run === generation && current === recognition;
      recognition.onaudiostart = () => { if (valid()) { clearTimeout(timeout); ensureTracker(); state('Safari está escuchando. Di la réplica y conserva tus pausas.'); } };
      recognition.onspeechend = () => { if (valid() && opened !== null) speechEndMs = Math.round(now() - opened); };
      recognition.onaudioend = () => { if (valid()) markInputEnd('audioend'); };
      recognition.onresult = event => {
        if (!valid()) return;
        clearTimeout(timeout); ensureTracker();
        const words = [], interim = [];
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i], text = result?.[0]?.transcript?.trim();
          if (text) { words.push(text); if (!result.isFinal) interim.push(text); }
        }
        currentText = [committed, ...words].filter(Boolean).join(' ');
        tracker.update(currentText, interim.join(' ')); state(ending ? 'Esperando el cierre natural de Safari…' : 'Safari está recibiendo tus palabras.');
      };
      recognition.onerror = event => {
        if (!valid()) return;
        error = `Safari: ${event.error || 'error de reconocimiento'}${event.message ? ` · ${event.message}` : ''}`;
        ending = true; state(`${error}. Esperando que el navegador cierre la escucha.`);
      };
      recognition.onend = () => {
        if (!valid()) return;
        clearTimeout(timeout); clearTimeout(closeWarning); current = null;
        committed = currentText;
        // Match the rehearsal's natural-end consolidation of provisional words.
        tracker?.update(currentText, '');
        markInputEnd('end'); serviceEndMs = opened === null ? null : Math.round(now() - opened);
        if (ending) save();
        else state('Safari cerró esta escucha. Puedes continuar la misma toma conservando las palabras, o terminarla.');
      };
      timeout = setTimeout(() => {
        if (!valid()) return;
        error = 'Safari no ha devuelto palabras ni confirmado entrada de audio.';
        state(`${error} Puedes terminar la toma; se esperará su cierre natural.`);
      }, 15000);
      sessions++; recognition.start();
      hasUsedNative = true;
      state('Abriendo el reconocimiento de Safari… espera a «Safari está escuchando».');
    } catch (cause) {
      // A synchronous start rejection cannot produce end: do not retain a
      // fictitious capture or block the other engines behind it.
      if (recognition) recognition.onend = recognition.onresult = recognition.onerror = null;
      current = null; error = cause.message || 'No se pudo iniciar Safari.'; save();
    }
  };
  const finish = () => {
    if (!ongoing) return;
    ending = true; finishRequested ??= now(); cancelPreparation?.(); cancelPreparation = null; preparing = false;
    if (!current) { save(); return; }
    state('Deja de hablar. Esperando el cierre natural de Safari, sin cortar su servicio…');
    if (!natural) { try { current.stop(); } catch {} }
    if (ongoing && current) closeWarning = setTimeout(() => state('Safari sigue sin cerrar la escucha. No abriremos otro micrófono encima. Puedes esperar o salir de esta página y volver.'), 12000);
  };
  const prepareBegin = () => {
    preparing = true; state('Preparando la escucha con el micrófono cerrado…');
    let completed = false;
    const cancel = prepareContinuation(cause => {
      completed = true; preparing = false; cancelPreparation = null;
      if (!ongoing || ending) return;
      if (cause) { error = cause.message; state(error); return; }
      begin();
    });
    if (!completed) cancelPreparation = cancel;
  };
  return {
    start: (options) => {
      if (current || preparing || ending) return;
      if (!ongoing) {
        if (!Constructor) { onResult({ engine: 'native', status: 'error', text: '', error: 'Este navegador no ofrece reconocimiento de voz nativo.',
          backend: 'browser', timingKind: 'native_live', verdict: null }); return; }
        generation++; ongoing = true; committed = currentText = ''; expected = options.expected; language = options.language;
        tracker = null; error = null; sessions = 0; started = now(); opened = null; speechEndMs = finishRequested = null;
        decisionInputEndMs = inputEndSignal = serviceEndMs = null;
        limit = setTimeout(finish, 45000);
        if (natural && hasUsedNative) prepareBegin(); else begin();
      } else {
        prepareBegin();
      }
    }, finish,
    suspend: () => {
      if (!ongoing) return;
      generation++; clearTimers(); cancelPreparation?.(); cancelPreparation = null;
      // Page hiding interrupts WebKit's capture. Detach stale callbacks without
      // abort/stop, exactly as the native rehearsal path does.
      if (current) current.onresult = current.onend = current.onerror = current.onaudiostart = current.onaudioend = current.onspeechend = null;
      current = null; error = 'Toma interrumpida al salir de la página.'; save();
    },
  };
};
