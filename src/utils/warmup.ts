import type { WarmupExercise, WarmupPreferences, WarmupTrack } from '../types/warmup';

// Editable starting examples, never an assessment of an individual singer.
export const WARMUP_VOICES = [
  { id: 'bass', label: 'Bajo', low: 40, high: 62, start: 46 },
  { id: 'baritone', label: 'Barítono', low: 43, high: 65, start: 50 },
  { id: 'tenor', label: 'Tenor', low: 48, high: 69, start: 53 },
  { id: 'alto', label: 'Contralto', low: 53, high: 74, start: 57 },
  { id: 'mezzo', label: 'Mezzosoprano', low: 55, high: 77, start: 60 },
  { id: 'soprano', label: 'Soprano', low: 60, high: 81, start: 62 },
] as const;

const note = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 36 && Number(value) <= 84;
export const noteName = (midi: number) => `${['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'][midi % 12]}${Math.floor(midi / 12) - 1}`;
export const sourceClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export const voicePreferences = (id: string): WarmupPreferences => {
  const voice = WARMUP_VOICES.find(value => value.id === id) || WARMUP_VOICES[1];
  return { voice: voice.id, low: voice.low, high: voice.high, exercises: {} };
};

export const restoreWarmupPreferences = (value: unknown): WarmupPreferences => {
  const stored = value as Partial<WarmupPreferences> | null;
  const result = voicePreferences(typeof stored?.voice === 'string' ? stored.voice : 'baritone');
  if (note(stored?.low) && note(stored?.high) && stored.low < stored.high) {
    result.low = stored.low; result.high = stored.high;
  }
  if (stored?.exercises && typeof stored.exercises === 'object') {
    Object.entries(stored.exercises).slice(0, 100).forEach(([id, setting]) => {
      if (!/^[a-z0-9-]{1,80}$/.test(id) || !setting || typeof setting !== 'object') return;
      const clean: { start?: number; low?: number; high?: number } = {};
      (['start', 'low', 'high'] as const).forEach(key => { if (note(setting[key])) clean[key] = setting[key]; });
      result.exercises[id] = clean;
    });
  }
  return result;
};

export const exerciseSettings = (exercise: WarmupExercise, prefs: WarmupPreferences) => {
  const custom = prefs.exercises[exercise.id];
  const voice = WARMUP_VOICES.find(value => value.id === prefs.voice) || WARMUP_VOICES[1];
  return { start: custom?.start ?? voice.start + exercise.score.startOffset,
    low: Math.max(prefs.low, custom?.low ?? prefs.low), high: Math.min(prefs.high, custom?.high ?? prefs.high) };
};

export const planWarmupExercise = (exercise: WarmupExercise, prefs: WarmupPreferences, explanation = true): {
  tracks: WarmupTrack[]; roots: number[]; low: number; high: number;
} => {
  const settings = exerciseSettings(exercise, prefs);
  const min = Math.min(...exercise.score.offsets), max = Math.max(...exercise.score.offsets);
  if (![settings.start, settings.low, settings.high].every(note) || settings.low >= settings.high) throw new Error('Revisa las notas grave, aguda e inicial de este ejercicio.');
  if (settings.high - settings.low < max - min) throw new Error(`Este patrón necesita ${max - min} semitonos. Amplía el rango o deja este ejercicio para otro momento.`);
  if (settings.start + min < settings.low || settings.start + max > settings.high) throw new Error('La nota inicial deja parte del patrón fuera de tu rango. Ajusta el inicio de este ejercicio.');
  const groups: { root: number; repetitions: number; sourceStep: number }[] = [];
  exercise.score.progression.forEach((entry, sourceStep) => {
    const root = settings.start + entry.offset;
    if (root + min < settings.low || root + max > settings.high) return;
    // Truncating a climb must not repeat its new summit on the way down.
    if (groups.at(-1)?.root === root) return;
    groups.push({ root, repetitions: entry.repetitions, sourceStep });
  });
  if (!groups.length) throw new Error('No hay repeticiones completas dentro de este rango.');
  const roots: number[] = [], tracks: WarmupTrack[] = [];
  if (explanation) tracks.push({ key: `${exercise.id}:explanation`, exerciseId: exercise.id, title: `${exercise.title} · Explicación`, phase: 'explanation', audio: exercise.explanation });
  groups.forEach(group => {
    exercise.cues.filter(cue => cue.beforeStep === group.sourceStep).forEach((cue, index) => tracks.push({
      key: `${exercise.id}:tip:${group.sourceStep}:${index}`, exerciseId: exercise.id, title: cue.text, phase: 'tip', audio: cue.audio,
    }));
    const prepared = exercise.piano[String(group.root)];
    if (!prepared) throw new Error(`Todavía no hay piano preparado para ${noteName(group.root)}. Elige otra nota inicial.`);
    for (let repeat = 0; repeat < group.repetitions; repeat++) {
      const index = roots.length; roots.push(group.root);
      tracks.push({ key: `${exercise.id}:piano:${index}:${group.root}`, exerciseId: exercise.id, title: `${exercise.title} · ${noteName(group.root)}`, phase: 'piano', audio: prepared, root: group.root });
    }
  });
  return { tracks, roots, low: Math.min(...roots) + min, high: Math.max(...roots) + max };
};
