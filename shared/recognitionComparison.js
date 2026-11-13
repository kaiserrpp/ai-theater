const finite = (value, max) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : null;
const signedMs = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 600000 ? Math.round(value) : null;
const normalizeTiming = value => {
  if (!value || typeof value !== 'object') return null;
  return { firstTextMs: finite(value.firstTextMs, 600000), acceptedAtMs: finite(value.acceptedAtMs, 600000),
    acceptedAudioMs: finite(value.acceptedAudioMs, 600000), decisionText: text(value.decisionText, 1200),
    inputEndMs: finite(value.inputEndMs, 600000), speechEndMs: finite(value.speechEndMs, 600000),
    inputEndSignal: ['audioend', 'end'].includes(value.inputEndSignal) ? value.inputEndSignal : null,
    matchToInputEndMs: finite(value.matchToInputEndMs, 600000), serviceEndMs: finite(value.serviceEndMs, 600000),
    speechEndKind: ['sample_rms_estimate', 'browser_speechend_event'].includes(value.speechEndKind) ? value.speechEndKind : null,
    decisionAfterSpeechMs: signedMs(value.decisionAfterSpeechMs), maxFeedLagMs: finite(value.maxFeedLagMs, 600000),
    replayMs: finite(value.replayMs, 600000), segmentationThreshold: finite(value.segmentationThreshold, 1),
    finishReason: ['settled', 'tail_timeout'].includes(value.finishReason) ? value.finishReason : null,
    startMs: finite(value.startMs, 600000), endWaitMs: finite(value.endWaitMs, 600000),
    durationMs: finite(value.durationMs, 600000), sessions: finite(value.sessions, 100),
    events: Array.isArray(value.events) ? value.events.slice(0, 40).map(event => ({
      atMs: finite(event?.atMs, 600000), audioMs: finite(event?.audioMs, 600000),
      text: text(event?.text, 600), interim: event?.interim === true,
    })) : [] };
};
const normalizeRecognitionComparison = (value) => {
  if (!value || !['native', 'vosk', 'whisper'].includes(value.engine) || !['done', 'error'].includes(value.status)) return null;
  return { sampleId: text(value.sampleId, 100), engine: value.engine, status: value.status,
    comparisonId: text(value.comparisonId, 100), sameAudioPair: value.engine !== 'native',
    model: text(value.model, 100), modelRevision: text(value.modelRevision, 80),
    backend: value.engine === 'native' ? 'browser' : value.backend === 'webgpu' ? 'webgpu' : 'wasm',
    encoderDevice: ['webgpu', 'wasm'].includes(value.encoderDevice) ? value.encoderDevice : null,
    encoderDtype: ['fp32', 'q8'].includes(value.encoderDtype) ? value.encoderDtype : null,
    fallbackReason: text(value.fallbackReason, 180),
    languageUsed: ['english', 'spanish'].includes(value.languageUsed) ? value.languageUsed : null,
    contextUsed: value.contextUsed === true, contextTermCount: finite(value.contextTermCount, 100),
    contextPrompt: value.contextUsed === true ? text(value.contextPrompt, 600) : null,
    sampleDurationMs: finite(value.sampleDurationMs, 45000), loadMs: finite(value.loadMs, 600000), processingMs: finite(value.processingMs, 600000),
    accepted: value.accepted === true, literalDifference: finite(value.literalDifference, 100),
    verdict: ['correct', 'incorrect'].includes(value.verdict) ? value.verdict : null,
    error: text(value.error, 500), order: ['vosk,whisper', 'whisper,vosk', 'native'].includes(value.order) ? value.order : null,
    timingKind: ['paced_replay', 'native_live'].includes(value.timingKind) ? value.timingKind : 'offline_processing',
    replay: value.timingKind === 'paced_replay' ? normalizeTiming(value.replay) : null,
    native: value.engine === 'native' ? normalizeTiming(value.native) : null, audioUploaded: false };
};
module.exports = { normalizeRecognitionComparison };
