import React, { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Text, TouchableOpacity, View } from 'react-native';
import { validateWarmupCatalog } from '../../shared/warmupCatalog';
import { buildSharedApiUrl } from '../api/sharedApiUrl';
import { importPreparedWarmup } from '../api/preparedWarmup';
import { useIsAdmin } from '../store/adminSession';
import type { WarmupCatalog, WarmupExercise, WarmupPreferences, WarmupTrack } from '../types/warmup';
import { createSongPlayback } from '../utils/songPlayback';
import { exerciseSettings, noteName, planWarmupExercise, sourceClock, voicePreferences, WARMUP_VOICES } from '../utils/warmup';
import { Button, Chip, Disclosure, Icon, usePracticeTheme } from './PracticeUI';
import { useWarmupAdvance } from '../hooks/useWarmupAdvance';
import type { WarmupSettings } from '../hooks/useWarmupPreferences';
import { vocalPractice } from '../store/vocalPractice';
import { createWarmupPianoPreparation } from '../utils/warmupPiano';
import { primeSongPracticeAudio } from '../utils/songPracticeAudio';

const NoteControl = ({ label, value, onChange, min = 36, max = 84, disabled = false }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; disabled?: boolean }) => {
  const { ui, palette } = usePracticeTheme();
  return <View style={[ui.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
    <Text style={ui.text}>{label}</Text><View style={ui.row}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Bajar ${label.toLowerCase()} un semitono`} disabled={disabled || value <= min} onPress={() => onChange(value - 1)} style={[ui.icon, (disabled || value <= min) && { opacity: .4 }]}><Icon name="minus" /></TouchableOpacity>
      <Text accessibilityLiveRegion="polite" style={{ color: palette.ink, minWidth: 52, textAlign: 'center', fontWeight: '700' }}>{noteName(value)}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Subir ${label.toLowerCase()} un semitono`} disabled={disabled || value >= max} onPress={() => onChange(value + 1)} style={[ui.icon, (disabled || value >= max) && { opacity: .4 }]}><Icon name="plus" /></TouchableOpacity>
    </View>
  </View>;
};

export const WarmupLibrary = ({ shareId, settings, onBeforePlay, createAudio, autoStart, onComplete, onSkip }: {
  shareId: string | null; onBeforePlay: () => void; createAudio?: () => HTMLAudioElement;
  settings: WarmupSettings;
  autoStart?: number; onComplete?: () => void; onSkip?: () => void;
}) => {
  const { ui, palette } = usePracticeTheme();
  const { preferences, loaded, storageError, save } = settings;
  const isAdmin = useIsAdmin();
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [catalog, setCatalog] = useState<WarmupCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [details, setDetails] = useState(false);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [exerciseOpen, setExerciseOpen] = useState<string | null>(null);
  const [tracks, setTracks] = useState<WarmupTrack[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queue, setQueue] = useState({ index: -1, total: 0 });
  const [error, setError] = useState('');
  const [rest, setRest] = useState(false);
  const [voiceAdvance, setVoiceAdvance] = useState(true);
  const [workout, setWorkout] = useState<{ exercises: WarmupExercise[]; index: number; key: number } | null>(null);
  const [retryStep, setRetryStep] = useState<{ session: NonNullable<typeof workout>; explanation: boolean } | null>(null);
  const [launching, setLaunching] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const workoutRef = useRef(workout); workoutRef.current = workout;
  const completeRef = useRef(() => {});
  const startStepRef = useRef<(exercise: WarmupExercise, explanation: boolean, token: number) => Promise<void>>(async () => {});
  const advanceRef = useRef(() => {});
  const voice = useWarmupAdvance(rest && workout ? `warmup:${workout.key}:${workout.index}` : null, voiceAdvance && Boolean(workout && workout.exercises.length > 1), () => advanceRef.current());
  const transition = useRef(0);
  const player = useRef<ReturnType<typeof createSongPlayback<WarmupTrack>> | null>(null);
  const media = useRef<HTMLAudioElement | null>(null);
  const preparation = useRef<ReturnType<typeof createWarmupPianoPreparation> | null>(null);
  if (!preparation.current) preparation.current = createWarmupPianoPreparation();
  const preparationAbort = useRef<AbortController | null>(null);
  const getAudio = () => media.current ??= createAudio ? createAudio() : new Audio();
  const current = tracks.find(track => track.key === selectedKey);
  const autoStarted = useRef<number | undefined>(undefined);
  const startFull = useRef(() => {});

  useEffect(() => () => { preparationAbort.current?.abort(); player.current?.destroy(); player.current = null; preparation.current?.clear(); }, []);
  useEffect(() => {
    const controller = new AbortController(); let cancelled = false;
    setLoading(Boolean(shareId)); setCatalog(null); setLoadError('');
    if (shareId) void fetch(buildSharedApiUrl('/api/shared-script', { resource: 'warmup', shareId }), { signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'No se pudo cargar el calentamiento.');
        if (payload.catalog !== null && validateWarmupCatalog(payload.catalog)) throw new Error('El calentamiento recibido está incompleto. Vuelve a intentarlo.');
        if (!cancelled) setCatalog(payload.catalog);
      }).catch(cause => { if (!cancelled) setLoadError(cause instanceof Error ? cause.message : 'No se pudo cargar el calentamiento.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [retry, shareId]);
  useEffect(() => { player.current?.setRepeat(repeat && workout?.exercises.length === 1 ? 'queue' : 'off'); }, [repeat, workout]);

  const change = (next: WarmupPreferences) => {
    preparationAbort.current?.abort();
    transition.current++; voice.releaseWarmupMicrophone(); player.current?.stop(); preparation.current?.clear(); setTracks([]); workoutRef.current = null; setWorkout(null); setRest(false); setRetryStep(null); setLaunching(false); setSkipping(false); setError(''); save(next);
  };
  const adjust = (exercise: WarmupExercise, field: 'start' | 'low' | 'high', value: number) => change({
    ...preferences, exercises: { ...preferences.exercises, [exercise.id]: { ...preferences.exercises[exercise.id], [field]: value } },
  });
  const playStep = async (exercise: WarmupExercise, explanation: boolean, token: number) => {
    const planned = planWarmupExercise(exercise, preferences, explanation).tracks;
    const session = workoutRef.current;
    if (catalog?.rest && session && session.index < session.exercises.length - 1) planned.push({
      key: `${exercise.id}:rest`, exerciseId: exercise.id, title: 'Descansa y bebe agua si te apetece', phase: 'rest', audio: catalog.rest.audio,
    });
    if (catalog && session && session.index === session.exercises.length - 1 &&
      session.exercises.length === catalog.exercises.length && session.exercises.every((item, index) => item.id === catalog.exercises[index].id)) planned.push({
      key: 'warmup:complete', exerciseId: exercise.id, title: 'Has terminado el calentamiento', phase: 'complete',
      audio: { audioUrl: '/audio/warmup-complete.mp3', durationSeconds: 6.188 },
    });
    preparationAbort.current?.abort(); const controller = new AbortController(); preparationAbort.current = controller;
    const next = await preparation.current!.prepare(planned, controller.signal);
    if (token !== transition.current) return;
    if (!next.length) return;
    if (Platform.OS !== 'web') throw new Error('Abre el calentamiento en la interfaz web de AI-Theatre.');
    onBeforePlay(); setError(''); setTracks(next);
    if (!player.current) player.current = createSongPlayback<WarmupTrack>({ createAudio: getAudio, onTrack: setSelectedKey, onPlaying: setPlaying,
      onPosition: setPosition, onDuration: setDuration, onQueue: setQueue, onError: setError, onComplete: () => completeRef.current() });
    player.current.stop();
    player.current.setRepeat(repeat && workoutRef.current?.exercises.length === 1 ? 'queue' : 'off');
    player.current.play(next[0], next, 'queue');
  };
  startStepRef.current = playStep;
  completeRef.current = () => {
    const session = workoutRef.current;
    if (!session) return;
    if (session.index < session.exercises.length - 1) setRest(true);
    else {
      voice.releaseWarmupMicrophone();
      workoutRef.current = null; setWorkout(null); setRest(false); setError('');
      if (catalog && session.exercises.length === catalog.exercises.length && session.exercises.every((exercise, index) => exercise.id === catalog.exercises[index].id)) {
        vocalPractice.recordActivity(true);
        // Release handlers before the next owner starts on the shared element.
        player.current?.destroy(); player.current = null; preparation.current?.clear(); onComplete?.();
      }
    }
  };
  const releaseAndPlay = async (session: NonNullable<typeof workout>, explanation = true) => {
    const token = ++transition.current;
    voice.stopRecognition(); voice.resetTranscript(); setRest(false); setLaunching(true); setError('');
    if (!await voice.waitForRecognitionEnd() || token !== transition.current) {
      if (token === transition.current) { setLaunching(false); setRetryStep({ session, explanation }); setError('La escucha aún se está cerrando. Reintenta para continuar con el mismo ejercicio.'); }
      return;
    }
    setRetryStep(null); workoutRef.current = session; setWorkout(session);
    try {
      await startStepRef.current(session.exercises[session.index], explanation, token);
      if (token === transition.current) setLaunching(false);
    } catch (cause) {
      if (token !== transition.current) return;
      setLaunching(false); setRetryStep({ session, explanation }); setError(cause instanceof Error ? cause.message : 'No se pudo preparar el ejercicio. Vuelve a intentarlo.');
    }
  };
  const start = (exercises: WarmupExercise[], explanation = true) => {
    try {
      const ordered = [...exercises].sort((a, b) => a.sourceStart - b.sourceStart);
      ordered.forEach(exercise => planWarmupExercise(exercise, preferences, explanation));
      if (ordered.length > 1) setRepeat(false);
      const session = { exercises: ordered, index: 0, key: Date.now() };
      voice.releaseWarmupMicrophone();
      if (voiceAdvance && ordered.length > 1) voice.prepareWarmupMicrophone();
      if (!media.current && Platform.OS === 'web' && autoStart === undefined) { onBeforePlay(); primeSongPracticeAudio(getAudio()); }
      player.current?.stop(); setTracks([]);
      void releaseAndPlay(session, explanation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Revisa el rango de los ejercicios.'); }
  };
  advanceRef.current = () => {
    const session = workoutRef.current;
    if (!rest || !session || session.index >= session.exercises.length - 1) return;
    void releaseAndPlay({ ...session, index: session.index + 1 });
  };
  const stop = () => { transition.current++; preparationAbort.current?.abort(); voice.releaseWarmupMicrophone(); player.current?.stop(); workoutRef.current = null; setWorkout(null); setRest(false); setRetryStep(null); setLaunching(false); setSkipping(false); };
  const skip = async () => {
    stop(); const token = transition.current; setLaunching(true); setSkipping(true);
    const ended = await voice.waitForRecognitionEnd();
    if (token !== transition.current) return;
    setLaunching(false); setSkipping(false);
    if (!ended) { setError('La escucha todavía se está cerrando. Vuelve a pulsar Ir directamente a cantar.'); return; }
    player.current?.destroy(); player.current = null; preparation.current?.clear();
    onSkip?.();
  };
  startFull.current = () => { if (catalog) start(catalog.exercises); };
  useEffect(() => {
    if (autoStart === undefined || autoStarted.current === autoStart || loading || catalog?.status !== 'complete' || !loaded) return;
    autoStarted.current = autoStart; startFull.current();
  }, [autoStart, catalog, loaded, loading]);
  useEffect(() => () => { transition.current++; }, []);

  return <View testID="warmup-library" style={{ gap: 14 }}>
    {onSkip ? <View testID="automatic-warmup" style={ui.card}><Text style={ui.subtitle}>Calentamos antes de cantar</Text><Button label="Ir directamente a cantar" secondary disabled={skipping} onPress={() => void skip()} /></View> : null}
    {loading ? <Text accessibilityLiveRegion="polite" style={ui.text}>Cargando calentamiento…</Text> : null}
    {loadError ? <View style={ui.card}><Text accessibilityRole="alert" style={ui.error}>{loadError}</Text><Button label="Reintentar calentamiento" secondary onPress={() => setRetry(value => value + 1)} /></View> : null}
    {!loading && !loadError && !catalog ? <View style={ui.card}><Text style={ui.subtitle}>Todavía no hay ejercicios preparados</Text><Text style={ui.text}>{shareId ? 'Los ejercicios aparecerán aquí cuando estén reconstruidos a partir de la referencia.' : 'Abre una obra compartida para acceder a sus audios desde tus dispositivos.'}</Text></View> : null}
    {isAdmin && shareId && Platform.OS === 'web' ? <Disclosure title="Administración del calentamiento"><View style={ui.card}>
      <input aria-label="Importar paquete de calentamiento preparado" type="file" accept=".json,application/json" disabled={importing} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        setImporting(true); setImportMessage('Comprobando el paquete preparado…');
        void importPreparedWarmup(file, shareId, setImportMessage).then(saved => {
          stop(); setTracks([]); setCatalog(saved); setLoadError(''); setImportMessage('Calentamiento guardado y comprobado. Disponible en los dispositivos que abran esta obra.');
        }).catch(cause => setImportMessage(cause instanceof Error ? cause.message : 'No se pudo importar el calentamiento.')).finally(() => setImporting(false));
      }} />
      {importMessage ? <Text accessibilityLiveRegion="polite" style={ui.text}>{importMessage}</Text> : null}
    </View></Disclosure> : null}
    {catalog ? <>
      <View style={[ui.card, { backgroundColor: palette.soft }]}>
        <Text style={ui.text}>{catalog.exercises.length} ejercicios · Explicación, piano y descanso</Text>
        {catalog.status === 'pilot' ? <Text style={ui.text}>Piloto para contrastar. El resto sigue en reconstrucción.</Text> : null}
        <Button label="Hacer calentamiento completo" disabled={catalog.status !== 'complete' || !loaded} onPress={() => start(catalog.exercises)} />
        <Text style={ui.text}>{voiceAdvance && voice.isSupported ? 'En los descansos, di «siguiente» o «adelante».' : 'En cada descanso, pulsa Siguiente ejercicio.'}</Text>
      </View>
      {rest && workout ? <View testID="warmup-rest" style={[ui.card, { backgroundColor: palette.soft }]}>
        <Text style={ui.subtitle}>Pausa para beber</Text><Text style={ui.text}>Has terminado {workout.exercises[workout.index].title}. A continuación: {workout.exercises[workout.index + 1]?.title}.</Text>
        <Text accessibilityLiveRegion="polite" style={ui.text}>{voiceAdvance && voice.isSupported ? voice.status === 'listening' ? 'Te escucho: di «siguiente» o «adelante» cuando estés listo.' : 'Preparando la escucha… También puedes continuar con el botón.' : 'Continúa cuando estés listo.'}</Text>
        {voice.error ? <><Text accessibilityRole="alert" style={ui.error}>{voice.error}</Text><Button label="Reintentar escucha del descanso" secondary onPress={voice.restartRecognition} /></> : null}
        <Button label="Siguiente ejercicio" onPress={() => advanceRef.current()} /><Button label="Detener calentamiento" secondary onPress={stop} />
      </View> : null}
      {launching ? <View style={ui.card}><Text style={ui.text}>Preparando el ejercicio…</Text><Button label="Cancelar calentamiento" secondary onPress={stop} /></View> : null}
      {current && !rest && !launching && !retryStep ? <View testID="warmup-player" style={[ui.card, { backgroundColor: palette.soft }]}>
        {workout ? <Text style={ui.label}>Ejercicio {workout.index + 1} de {workout.exercises.length}</Text> : <Text style={ui.label}>Ejercicio terminado. Puedes repetirlo o iniciar otra selección.</Text>}
        <Text style={ui.subtitle}>{current.title}</Text>
        <Text accessibilityLiveRegion="polite" style={ui.text}>{queue.index + 1} de {queue.total} · {current.phase === 'piano' ? 'Piano' : current.phase === 'tip' ? 'Consejo' : current.phase === 'rest' ? 'Aviso de descanso' : current.phase === 'complete' ? 'Calentamiento terminado' : 'Explicación'}{repeat ? ' · En bucle' : ''}</Text>
        <View style={ui.row}><View style={{ flex: 1 }}><Button label={playing ? 'Pausar calentamiento' : 'Reanudar calentamiento'} onPress={() => { if (playing) player.current?.pause(); else player.current?.resume(); }} /></View><Button label="Detener" secondary onPress={stop} /></View>
        {Platform.OS === 'web' ? <input aria-label="Posición del audio de calentamiento" type="range" min={0} max={duration || 1} step={.1} value={position} style={{ width: '100%', accentColor: palette.plum, minHeight: 30 }} onChange={event => player.current?.seek(Number(event.target.value))} /> : null}
        <Text style={ui.text}>{sourceClock(position)} / {sourceClock(duration)} de este audio</Text>
        {!workout || workout.exercises.length === 1 ? <Chip label="Repetir ejercicio o selección" selected={repeat} onPress={() => setRepeat(value => !value)} /> : null}
      </View> : null}
      {error ? <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={ui.error}>{error}</Text>{retryStep ? <><Button label="Reintentar siguiente audio" onPress={() => void releaseAndPlay(retryStep.session, retryStep.explanation)} /><Button label="Cancelar calentamiento" secondary onPress={stop} /></> : current ? <Button label="Reintentar ejercicio" secondary onPress={() => {
        const exercise = catalog.exercises.find(item => item.id === current.exerciseId);
        if (exercise) start([exercise], tracks[0]?.phase === 'explanation');
      }} /> : null}</View> : null}
      <View style={[ui.card, { padding: 16 }]}><Disclosure title="Tu voz y ajustes" summary={`${WARMUP_VOICES.find(voice => voice.id === preferences.voice)?.label || 'Rango personal'} · ${noteName(preferences.low)}–${noteName(preferences.high)}`}>
        <View style={ui.wrap}>{WARMUP_VOICES.map(voice => <Chip key={voice.id} label={voice.label} selected={preferences.voice === voice.id} disabled={!loaded} onPress={() => change(voicePreferences(voice.id))} />)}</View>
        <Text style={ui.text}>Cada cuerda es un punto de partida editable. Elige las notas que te resulten cómodas; la etiqueta no determina tu rango personal. Al elegir otra cuerda se restablecen sus valores de partida.</Text>
        <NoteControl label="Límite grave" value={preferences.low} disabled={!loaded} onChange={low => change({ ...preferences, low })} />
        <NoteControl label="Límite agudo" value={preferences.high} disabled={!loaded} onChange={high => change({ ...preferences, high })} />
        <Text style={ui.text}>Se recuerda en este dispositivo. Puedes ajustar por separado el inicio y los límites de cada ejercicio. Do4 = C4 = MIDI 60.</Text>
        <Chip label="Continuar por voz durante los descansos" selected={voiceAdvance} onPress={() => {
          if (voiceAdvance) voice.releaseWarmupMicrophone();
          else if (workout && workout.exercises.length > 1) voice.prepareWarmupMicrophone();
          setVoiceAdvance(value => !value);
        }} />
        {!voice.isSupported && voiceAdvance ? <Text style={ui.text}>Puedes continuar con el botón Siguiente ejercicio.</Text> : null}
      </Disclosure></View>
      {storageError ? <Text accessibilityRole="alert" style={ui.error}>{storageError}</Text> : null}
      <Text style={ui.label}>EJERCICIOS</Text>
      {catalog.exercises.map((exercise, index) => {
        const settings = exerciseSettings(exercise, preferences);
        let summary = '', problem = '';
        try { const plan = planWarmupExercise(exercise, preferences); summary = `${noteName(plan.low)}–${noteName(plan.high)} · ${plan.roots.length} recorridos`; }
        catch (cause) { problem = cause instanceof Error ? cause.message : 'Revisa el rango.'; }
        return <View key={exercise.id} testID="warmup-exercise" style={[ui.card, { padding: 14 }, current?.exerciseId === exercise.id && { borderColor: palette.plum }]}>
          <View style={[ui.row, { gap: 8 }]}><Text style={ui.label}>{index + 1}</Text>
            <Text style={[ui.text, { flex: 1, color: palette.ink, fontWeight: '600' }]}>{exercise.title}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Escuchar explicación y piano · ${exercise.title}`} disabled={Boolean(problem) || !loaded} onPress={() => start([exercise])} style={[ui.icon, { width: 44 }]}><Icon name="play-circle-outline" size={30} /></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Opciones de ${exercise.title}`} accessibilityState={{ expanded: exerciseOpen === exercise.id }} onPress={() => setExerciseOpen(value => value === exercise.id ? null : exercise.id)} style={[ui.icon, { width: 44 }]}><Icon name={exerciseOpen === exercise.id ? 'chevron-up' : 'chevron-down'} size={22} /></TouchableOpacity>
          </View>
          {problem ? <Text accessibilityRole="alert" style={ui.error}>{problem}</Text> : null}
          {exerciseOpen === exercise.id ? <View style={{ gap: 12 }}>
          <Text style={ui.text}>Inicio: {noteName(settings.start)} · {summary || 'Rango pendiente de ajustar'}</Text>
          <Button label={`Sólo piano · ${exercise.title}`} secondary disabled={Boolean(problem) || !loaded} onPress={() => start([exercise], false)} />
          <Chip label="Repetir ejercicio" selected={repeat} disabled={Boolean(workout && workout.exercises.length > 1)} onPress={() => setRepeat(value => !value)} />
          <Chip label={adjusting === exercise.id ? 'Cerrar ajuste del ejercicio' : 'Ajustar este ejercicio'} selected={adjusting === exercise.id} onPress={() => setAdjusting(value => value === exercise.id ? null : exercise.id)} />
          {adjusting === exercise.id ? <View style={{ gap: 8 }}>
            <NoteControl label="Nota inicial" value={settings.start} onChange={value => adjust(exercise, 'start', value)} />
            <NoteControl label="Grave del ejercicio" value={settings.low} min={preferences.low} max={preferences.high} onChange={value => adjust(exercise, 'low', value)} />
            <NoteControl label="Agudo del ejercicio" value={settings.high} min={preferences.low} max={preferences.high} onChange={value => adjust(exercise, 'high', value)} />
            <Text style={ui.text}>Los límites de este ejercicio quedan dentro de tu rango general. Se acorta la subida antes de salir de ellos, conservando el patrón completo.</Text>
          </View> : null}
          <Disclosure title={`Cómo hacer ${exercise.title}`}>
          <Text style={ui.text}>{exercise.objective}</Text><Text style={ui.text}>{exercise.instructions}</Text>
          {exercise.advice.map((tip, index) => <Text key={index} style={ui.text}>{tip.text}</Text>)}
          </Disclosure></View> : null}
        </View>;
      })}
      <Chip label={details ? 'Ocultar referencias y detalles musicales' : 'Referencias y detalles musicales'} selected={details} onPress={() => setDetails(value => !value)} />
      {details ? <View style={ui.card}><Text style={ui.subtitle}>Referencia y reconstrucción</Text>
        <Text style={ui.text}>Vídeo de {sourceClock(catalog.source.durationSeconds)}. La transcripción automática se ha usado como apoyo y contiene errores. Las dudas siguen abiertas. El vídeo original no se ha publicado en la app.</Text>
        {catalog.exercises.map(exercise => <View key={exercise.id} style={{ gap: 6 }}><Text style={ui.label}>{exercise.title} · {sourceClock(exercise.sourceStart)}–{sourceClock(exercise.sourceEnd)}</Text>
          {exercise.advice.map((tip, index) => <Text key={index} style={ui.text}>{sourceClock(tip.sourceAt)} · {tip.text}</Text>)}
          <Text style={ui.text}>{exercise.score.description} · {exercise.score.tempoBpm} negras/min. Entrada de {exercise.score.preparationBeats} pulsos y cierre de {exercise.score.closingBeats} pulso. {exercise.score.progressionDescription}</Text>
          {exercise.uncertainties.map((uncertainty, index) => <Text key={index} style={ui.text}>Por contrastar: {uncertainty}</Text>)}
        </View>)}
        {catalog.pending.map((item, index) => <View key={index} style={{ gap: 4 }}><Text style={[ui.text, { color: palette.ink, fontWeight: '600' }]}>{sourceClock(item.sourceStart)}–{sourceClock(item.sourceEnd)} · {item.title}</Text><Text style={ui.text}>{item.note}</Text></View>)}
        {catalog.credits.map(credit => <TouchableOpacity key={credit.url} accessibilityRole="link" onPress={() => void Linking.openURL(credit.url)}><Text style={[ui.text, { color: palette.plum, textDecorationLine: 'underline' }]}>{credit.label}</Text></TouchableOpacity>)}
      </View> : null}
    </> : null}
  </View>;
};
