const milliseconds = value => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(0, Math.min(86400000, Math.round(value))) : null;
const count = value => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(0, Math.min(100000, Math.round(value))) : 0;
const normalizeRecognitionSessionDiagnostics = value => {
  if (!value || value.kind !== 'recognition_session' || ![
    'unsupported', 'idle', 'suspended', 'preparing', 'processing', 'finishing', 'starting', 'listening', 'error',
  ].includes(value.status)) return null;
  return { kind: 'recognition_session', elapsedMs: milliseconds(value.elapsedMs) ?? 0, status: value.status,
    startCount: count(value.startCount), audioStartCount: count(value.audioStartCount), textEventCount: count(value.textEventCount),
    endCount: count(value.endCount), retryCount: count(value.retryCount), noSpeechCount: count(value.noSpeechCount),
    firstServiceStartMs: milliseconds(value.firstServiceStartMs), firstAudioStartMs: milliseconds(value.firstAudioStartMs),
    firstTextMs: milliseconds(value.firstTextMs), currentTranscriptEmpty: value.currentTranscriptEmpty === true,
    inputActive: value.inputActive === true, inputAlreadyActive: value.inputAlreadyActive === true,
    errors: Array.isArray(value.errors) ? value.errors.slice(-8).filter(error => error && typeof error.code === 'string' &&
      /^[a-z0-9_-]{1,80}$/i.test(error.code) && milliseconds(error.atMs) !== null)
      .map(error => ({ code: error.code, atMs: milliseconds(error.atMs) })) : [] };
};
module.exports = { normalizeRecognitionSessionDiagnostics };
