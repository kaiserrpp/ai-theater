const finite = (value, max) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : null;
const normalizeRecognitionComparison = (value) => {
  if (!value || !['vosk', 'whisper'].includes(value.engine) || !['done', 'error'].includes(value.status)) return null;
  return { sampleId: text(value.sampleId, 100), engine: value.engine, status: value.status,
    model: text(value.model, 100), modelRevision: text(value.modelRevision, 80), backend: 'wasm',
    languageUsed: ['english', 'spanish'].includes(value.languageUsed) ? value.languageUsed : null,
    sampleDurationMs: finite(value.sampleDurationMs, 45000), loadMs: finite(value.loadMs, 600000), processingMs: finite(value.processingMs, 600000),
    accepted: value.accepted === true, literalDifference: finite(value.literalDifference, 100),
    verdict: ['correct', 'incorrect'].includes(value.verdict) ? value.verdict : null,
    error: text(value.error, 500), order: ['vosk,whisper', 'whisper,vosk'].includes(value.order) ? value.order : null,
    timingKind: 'offline_processing', audioUploaded: false };
};
module.exports = { normalizeRecognitionComparison };
