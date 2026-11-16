const object = value => value && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 5000;
const identifier = value => typeof value === 'string' && /^[a-z0-9-]{1,80}$/.test(value);
const url = value => {
  try { const parsed = new URL(value); return parsed.protocol === 'https:' && !parsed.username && !parsed.password; } catch { return false; }
};
const audio = value => object(value) && url(value.audioUrl) && finite(value.durationSeconds) && value.durationSeconds > 0 && value.durationSeconds < 1800;

// A partially rendered score must never appear as a playable exercise.
const validateWarmupCatalog = catalog => {
  if (!object(catalog) || catalog.version !== 1 || !identifier(catalog.id) || !text(catalog.title) || !['pilot', 'complete'].includes(catalog.status)) return 'Catálogo de calentamiento no válido.';
  if (!object(catalog.source) || !finite(catalog.source.durationSeconds) || catalog.source.durationSeconds <= 0 || !/^[a-f0-9]{64}$/.test(catalog.source.sha256)) return 'Falta la referencia del calentamiento.';
  const at = value => finite(value) && value >= 0 && value <= catalog.source.durationSeconds;
  if (!Array.isArray(catalog.exercises) || !catalog.exercises.length || catalog.exercises.length > 50) return 'No hay ejercicios preparados.';
  const ids = new Set();
  for (const exercise of catalog.exercises) {
    if (!object(exercise) || !identifier(exercise.id) || ids.has(exercise.id) || !text(exercise.title) || !text(exercise.objective) || !text(exercise.instructions)) return 'Ejercicio de calentamiento no válido.';
    ids.add(exercise.id);
    if (!at(exercise.sourceStart) || !at(exercise.sourceEnd) || exercise.sourceEnd <= exercise.sourceStart) return 'Las marcas de tiempo no son válidas.';
    if (!Array.isArray(exercise.advice) || !exercise.advice.every(tip => object(tip) && text(tip.text) && at(tip.sourceAt))) return 'Consejos sin referencia válida.';
    if (!Array.isArray(exercise.uncertainties) || !exercise.uncertainties.every(text)) return 'Dudas del ejercicio no válidas.';
    const score = exercise.score;
    if (!object(score) || !text(score.description) || !text(score.progressionDescription) || ![score.entranceNotes, score.closingNotes].every(notes => Array.isArray(notes) && notes.length <= 16 && notes.every(note => Number.isInteger(note) && Math.abs(note) <= 24))) return 'Falta la descripción del piano.';
    if (!object(score) || !Array.isArray(score.offsets) || !score.offsets.length || score.offsets.length > 100 || !score.offsets.every(n => Number.isInteger(n) && Math.abs(n) <= 24) || !Array.isArray(score.noteBeats) || score.noteBeats.length !== score.offsets.length || !score.noteBeats.every(n => finite(n) && n > 0 && n <= 16)) return 'Patrón musical no válido.';
    if (!finite(score.tempoBpm) || score.tempoBpm < 30 || score.tempoBpm > 240 || !finite(score.preparationBeats) || score.preparationBeats < 0 || score.preparationBeats > 16 || !finite(score.closingBeats) || score.closingBeats < 0 || score.closingBeats > 16 || !Number.isInteger(score.sourceRoot) || score.sourceRoot < 0 || score.sourceRoot > 127 || !Number.isInteger(score.startOffset) || Math.abs(score.startOffset) > 24) return 'Tiempo o registro musical no válido.';
    if (!Array.isArray(score.progression) || !score.progression.length || score.progression.length > 100 || !score.progression.every(step => object(step) && Number.isInteger(step.offset) && Math.abs(step.offset) <= 24 && Number.isInteger(step.repetitions) && step.repetitions >= 1 && step.repetitions <= 10)) return 'Progresión musical no válida.';
    if (!audio(exercise.explanation) || !object(exercise.piano) || !Object.keys(exercise.piano).length || Object.keys(exercise.piano).length > 100 || !Object.entries(exercise.piano).every(([key, take]) => /^(?:[3-7][0-9]|8[0-4])$/.test(key) && audio(take))) return 'Faltan audios preparados.';
    if (!Array.isArray(exercise.cues) || !exercise.cues.every(cue => object(cue) && Number.isInteger(cue.beforeStep) && cue.beforeStep >= 0 && cue.beforeStep < score.progression.length && text(cue.text) && at(cue.sourceAt) && audio(cue.audio))) return 'Avisos del ejercicio no válidos.';
  }
  if (!Array.isArray(catalog.pending) || catalog.pending.length > 50 || !catalog.pending.every(item => object(item) && text(item.title) && text(item.note) && at(item.sourceStart) && at(item.sourceEnd) && item.sourceEnd > item.sourceStart)) return 'Ejercicios pendientes no válidos.';
  if (catalog.status === 'complete' && catalog.pending.length) return 'El calentamiento aún contiene ejercicios pendientes.';
  if (!Array.isArray(catalog.credits) || !catalog.credits.every(item => object(item) && text(item.label) && url(item.url))) return 'Créditos no válidos.';
  return null;
};
module.exports = { validateWarmupCatalog };
