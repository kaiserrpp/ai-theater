import { scoreLineMatch, getAutomaticLineAdvanceDelay } from './line-matching.mjs';
import { getWhisperSegmentationThreshold } from './whisperSpeechActivity.mjs';
import { SAMPLE_RATE, checkAbort, abortError } from './comparison-core.mjs';

// The same provisional/final gates and delays as the rehearsal, without
// advancing a scene or replacing an ASR hypothesis with the script text.
export const createDecisionTracker = ({ expected, now = () => performance.now(), getAudioMs = () => null, onAccepted = () => {} }) => {
  const started = now();
  let text = '', interim = '', firstTextMs = null, decision = null, timer = null, key = '', disposed = false;
  const events = [];
  const update = (next, provisional, audioMs = null) => {
    if (disposed) return;
    text = next.trim(); interim = provisional.trim();
    const nextKey = `${text}\n${interim}`;
    if (nextKey === key) return;
    key = nextKey;
    if (timer !== null) clearTimeout(timer); timer = null;
    const atMs = Math.round(now() - started);
    if (text && firstTextMs === null) firstTextMs = atMs;
    if (text && events.length < 40) events.push({ atMs, audioMs, text: text.slice(0, 600), interim: Boolean(interim) });
    if (decision || !text) return;
    const delay = getAutomaticLineAdvanceDelay(expected, text, interim, scoreLineMatch(expected, text));
    if (delay === null) return;
    const accept = () => {
      timer = null;
      if (disposed || decision) return;
      decision = { acceptedAtMs: Math.round(now() - started), acceptedAudioMs: getAudioMs() ?? audioMs, decisionText: text.slice(0, 1200) };
      onAccepted(decision);
    };
    if (!delay) accept(); else timer = setTimeout(accept, delay);
  };
  return { update, getText: () => text, getInterim: () => interim,
    snapshot: () => ({ firstTextMs, acceptedAtMs: decision?.acceptedAtMs ?? null,
      acceptedAudioMs: decision?.acceptedAudioMs ?? null, decisionText: decision?.decisionText ?? null, events: events.slice() }),
    dispose: () => { disposed = true; if (timer !== null) clearTimeout(timer); },
  };
};

// This is an acoustic estimate, not the actor's confirmed last word. Keep the
// exact sample boundary and feed lag alongside it so reports cannot confuse it
// with physical speaker latency or a perfectly aligned reference.
export const estimateSampleSpeech = (audio) => {
  const levels = [];
  for (let at = 0; at < audio.length; at += 640) {
    const chunk = audio.subarray(at, at + 640);
    levels.push(Math.sqrt(chunk.reduce((sum, v) => sum + v * v, 0) / chunk.length));
  }
  const sorted = levels.slice().sort((a, b) => a - b);
  const voice = sorted[Math.floor(sorted.length * 0.9)] || 0;
  const noise = sorted[Math.floor(sorted.length * 0.1)] || 0;
  const threshold = getWhisperSegmentationThreshold(noise, voice);
  let end = -1;
  levels.forEach((value, i) => { if (value >= threshold) end = i; });
  return { threshold, speechEndMs: end < 0 ? null : Math.min(audio.length / 16, (end + 1) * 40) };
};

const pause = (ms, signal) => new Promise((resolve, reject) => {
  checkAbort(signal);
  const abort = () => { clearTimeout(timer); reject(abortError()); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
  signal.addEventListener('abort', abort, { once: true });
});

export const replaySample = async ({ audio, expected, signal, createRecognizer, onProgress = () => {},
  now = () => performance.now(), wait = pause, tailMs = 10000 }) => {
  checkAbort(signal);
  const speech = estimateSampleSpeech(audio), loadStarted = now();
  let recognizer, tracker, position = 0, finalPosition = -1, failure = null;
  const finals = [];
  try {
    const prepared = await createRecognizer(speech.threshold);
    recognizer = prepared.recognizer; checkAbort(signal);
    const loadMs = now() - loadStarted, started = now();
    tracker = createDecisionTracker({ expected, now, getAudioMs: () => position / 16 });
    recognizer.on('error', message => { failure = new Error(message.error || 'Error de reconocimiento.'); });
    recognizer.on('partialresult', message => {
      const partial = message.result?.partial?.trim() || '';
      tracker.update([...finals, partial].filter(Boolean).join(' '), partial, position / 16);
    });
    recognizer.on('result', message => {
      const text = message.result?.text?.trim(); if (text) finals.push(text);
      finalPosition = position;
      tracker.update(finals.join(' '), '', position / 16);
    });
    let maxFeedLagMs = 0, inputEndMs = null, finishReason = 'tail_timeout';
    const limit = audio.length + Math.round(tailMs / 1000 * SAMPLE_RATE);
    onProgress('Reproduciendo la muestra a velocidad normal…');
    while (position < limit) {
      const next = Math.min(position + 640, position < audio.length ? audio.length : limit);
      const deadline = (next / SAMPLE_RATE) * 1000;
      await wait(Math.max(0, deadline - (now() - started)), signal); checkAbort(signal);
      maxFeedLagMs = Math.max(maxFeedLagMs, now() - started - deadline);
      // Check acknowledgements before queuing another silent frame. A worker
      // cannot be idle immediately after receiving that new frame.
      if (position >= audio.length + SAMPLE_RATE * 1.5 && prepared.isIdle() &&
          finalPosition / 16 >= (speech.speechEndMs ?? 0) && !tracker.getInterim()) {
        finishReason = 'settled'; break;
      }
      const chunk = position < audio.length ? audio.slice(position, next) : new Float32Array(next - position);
      position = next;
      recognizer.acceptWaveform({ getChannelData: () => chunk });
      if (failure) throw failure;
      if (position >= audio.length && inputEndMs === null) {
        inputEndMs = Math.round(now() - started); onProgress('Esperando los últimos resultados…');
      }
    }
    checkAbort(signal);
    if (failure) throw failure;
    const timing = tracker.snapshot();
    return { text: tracker.getText(), loadMs, processingMs: null, ...prepared.details(), timingKind: 'paced_replay',
      replay: { ...timing, inputEndMs, speechEndMs: speech.speechEndMs, speechEndKind: 'sample_rms_estimate',
        decisionAfterSpeechMs: timing.acceptedAtMs === null || speech.speechEndMs === null ? null : timing.acceptedAtMs - speech.speechEndMs,
        maxFeedLagMs: Math.round(maxFeedLagMs), replayMs: Math.round(now() - started), finishReason,
        segmentationThreshold: speech.threshold } };
  } finally { tracker?.dispose(); recognizer?.remove(); }
};
