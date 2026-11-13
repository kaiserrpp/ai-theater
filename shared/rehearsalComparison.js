const normalizeRehearsalComparison = value => {
  if (!value || value.execution !== 'parallel' || typeof value.id !== 'string' || !Array.isArray(value.results)) return null;
  const bounded = (input, max) => typeof input === 'number' && Number.isFinite(input) ? Math.max(0, Math.min(max, input)) : null;
  const text = (input, max) => typeof input === 'string' ? input.slice(0, max) : null;
  const seen = new Set();
  return { id: text(value.id, 100), execution: 'parallel', sameUtterance: true,
    sharedPcm: ['vosk', 'whisper'], nativeIndependentCapture: true,
    completion: ['speech_end', 'button', 'manual', 'exit', 'capture_failed'].includes(value.completion) ? value.completion : 'manual',
    elapsedMs: bounded(value.elapsedMs, 600000), quietMs: bounded(value.quietMs, 10000),
    speechStartMs: bounded(value.speechStartMs, 600000), speechEndMs: bounded(value.speechEndMs, 600000), inputClosedMs: bounded(value.inputClosedMs, 600000),
    speechTimingSource: value.speechTimingSource === 'native_result_event' ? 'native_result_event' : 'shared_capture_rms',
    results: value.results.filter(item => item && ['native', 'vosk', 'whisper'].includes(item.engine) && !seen.has(item.engine) && seen.add(item.engine)).slice(0, 3).map(item => ({
      engine: item.engine, text: text(item.text, 1200) || '',
      status: ['done', 'error', 'timeout', 'incomplete', 'interrupted'].includes(item.status) ? item.status : 'interrupted',
      error: text(item.error, 500), score: bounded(item.score, 1), coverageScore: bounded(item.coverageScore, 1),
      precisionScore: bounded(item.precisionScore, 1), orderScore: bounded(item.orderScore, 1), finalScore: bounded(item.finalScore, 1),
      firstTextMs: bounded(item.firstTextMs, 600000), finalTextMs: bounded(item.finalTextMs, 600000),
      finishedMs: bounded(item.finishedMs, 600000),
      timing: item.timing?.kind === 'live_processing' ? { kind: 'live_processing',
        requestToTextMs: bounded(item.timing.requestToTextMs, 180000), processingMs: bounded(item.timing.processingMs, 180000),
        audioDurationMs: bounded(item.timing.audioDurationMs, 180000), queueMs: bounded(item.timing.queueMs, 180000),
        encoderDevice: ['wasm', 'webgpu'].includes(item.timing.encoderDevice) ? item.timing.encoderDevice : null,
        encoderDtype: ['fp32', 'q8'].includes(item.timing.encoderDtype) ? item.timing.encoderDtype : null,
        decoderDevice: 'wasm', fallbackReason: text(item.timing.fallbackReason, 180) } : null,
    })) };
};
module.exports = { normalizeRehearsalComparison };
