import { scoreLineMatch, getAutomaticLineAdvanceDelay, getAutomaticLineMatchReason } from './line-matching.mjs';

export const SAMPLE_RATE = 16000;
export const MAX_SAMPLE_SECONDS = 45;
export const WHISPER_MODEL = 'Xenova/whisper-tiny';
export const WHISPER_REVISION = '5332fcc35e32a33b86612b9a57a89be7906102b1';
export const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
export const PHRASES = [
  'Ey, Sonny.',
  'Tengo noticias. My English is getting much better.',
  'Really?',
  'Sure (se ríe).',
  'Ya lo sé, pero hay dos idiomas distintos: Dominican English y Puerto Rican English. Necesito unas lecciones extras.',
  'Abuela, ¿qué pasó? ¿Por qué gritas? ¿Pasó algo malo?',
  'Cada mañana abro la tienda, preparo el café y reviso todos los encargos antes de que mis vecinos salgan hacia el trabajo.',
];

export const abortError = () => Object.assign(new Error('Comparación detenida. La muestra sigue disponible.'), { name: 'AbortError' });
export const checkAbort = (signal) => { if (signal?.aborted) throw abortError(); };

export const resampleAudio = (input, sourceRate, targetRate = SAMPLE_RATE) => {
  if (!(sourceRate > 0) || !(targetRate > 0)) throw new Error('Frecuencia de audio no válida.');
  if (sourceRate === targetRate) return input.slice();
  const ratio = sourceRate / targetRate;
  const result = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < result.length; i++) {
    if (ratio < 1) {
      const at = i * ratio, left = Math.floor(at), fraction = at - left;
      result[i] = input[left] * (1 - fraction) + input[Math.min(left + 1, input.length - 1)] * fraction;
    } else {
      const start = i * ratio, end = Math.min(input.length, (i + 1) * ratio);
      let sum = 0;
      for (let j = Math.floor(start); j < Math.ceil(end); j++) sum += input[j] * (Math.min(j + 1, end) - Math.max(j, start));
      result[i] = sum / (end - start);
    }
  }
  return result;
};

const literalTokens = (text) => text.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter(Boolean);
export const literalDifference = (expected, heard) => {
  const a = literalTokens(expected), b = literalTokens(heard);
  if (!a.length) return null;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length] / a.length;
};

export const evaluateTranscript = (expected, heard) => {
  const match = scoreLineMatch(expected, heard);
  return { ...match, accepted: getAutomaticLineAdvanceDelay(expected, heard, '', match) !== null,
    reason: getAutomaticLineMatchReason(expected, heard, match), literalDifference: literalDifference(expected, heard) };
};

// Both engines receive independent copies of the same full sample. A pause is
// audio within the sample, never a signal to change the expected line.
export const compareSample = async ({ audio, expected, language = 'auto', order = ['vosk', 'whisper'], engines, signal, onResult = () => {}, onProgress = () => {} }) => {
  if (!audio.length || audio.length > SAMPLE_RATE * MAX_SAMPLE_SECONDS) throw new Error('La muestra debe durar entre un instante y 45 segundos.');
  const results = [];
  for (const engine of order) {
    checkAbort(signal);
    onProgress(engine, 'Preparando modelo…');
    let result;
    try {
      const output = await engines[engine](audio.slice(), { signal, language, onProgress: (message) => { if (!signal?.aborted) onProgress(engine, message); } });
      checkAbort(signal);
      result = { engine, status: 'done', ...output, ...evaluateTranscript(expected, output.text), verdict: null };
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw abortError();
      result = { engine, status: 'error', text: '', error: error?.message || String(error), verdict: null };
    }
    results.push(result); onResult(result);
    // Every engine releases its decoder/worker before the next one starts.
  }
  return results;
};

export const makeFeedbackEntries = (trial) => trial.results.map((result) => ({
  lineIndex: trial.phraseIndex, character: 'PRUEBA LOCAL', sceneTitle: 'Whisper frente a Vosk',
  expectedText: trial.expected, heardText: result.text || '', score: result.score || 0,
  coverageScore: result.coverageScore, orderScore: result.orderScore, finalScore: result.finalScore,
  finalPhraseScore: result.finalPhraseScore, finalPhraseWordCount: result.finalPhraseWordCount,
  precisionScore: result.precisionScore, negationPenaltyApplied: result.negationPenaltyApplied,
  autoAdvanceReason: result.reason, result: 'comparacion_local',
  matchedReferenceText: result.referenceText || trial.expected, matchedReferenceIndex: result.referenceIndex || 0,
  language: result.engine === 'vosk' ? 'es-ES' : trial.language, createdAt: trial.createdAt,
  recognitionComparison: { sampleId: trial.id, engine: result.engine, status: result.status,
    model: result.engine === 'vosk' ? 'vosk-model-small-es-0.42' : WHISPER_MODEL,
    backend: 'wasm', modelRevision: result.engine === 'whisper' ? WHISPER_REVISION : '0.42',
    sampleDurationMs: trial.durationMs, processingMs: result.processingMs, loadMs: result.loadMs,
    languageUsed: result.engine === 'vosk' ? 'spanish' : result.languageUsed,
    accepted: result.accepted ?? false, literalDifference: result.literalDifference,
    verdict: result.verdict, error: result.error || null, order: trial.order.join(','),
    timingKind: 'offline_processing', audioUploaded: false },
}));
