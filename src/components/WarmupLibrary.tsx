import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Text, TouchableOpacity, View } from 'react-native';
import { validateWarmupCatalog } from '../../shared/warmupCatalog';
import { buildSharedApiUrl } from '../api/sharedApiUrl';
import { importPreparedWarmup } from '../api/preparedWarmup';
import { useIsAdmin } from '../store/adminSession';
import type { WarmupCatalog, WarmupExercise, WarmupPreferences, WarmupTrack } from '../types/warmup';
import { createSongPlayback } from '../utils/songPlayback';
import { exerciseSettings, noteName, planWarmupExercise, restoreWarmupPreferences, sourceClock, voicePreferences, WARMUP_VOICES } from '../utils/warmup';
import { Button, Chip, Icon, usePracticeTheme } from './PracticeUI';
import { useWarmupAdvance } from '../hooks/useWarmupAdvance';
import { vocalPractice } from '../store/vocalPractice';

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

export const WarmupLibrary = ({ shareId, onBeforePlay, createAudio, autoStart, onComplete, onSkip }: {
  shareId: string | null; onBeforePlay: () => void; createAudio?: () => HTMLAudioElement;
  autoStart?: number; onComplete?: () => void; onSkip?: () => void;
}) => {
  const { ui, palette } = usePracticeTheme();
  const isAdmin = useIsAdmin();
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState('');
  const [catalog, setCatalog] = useState<WarmupCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [preferences, setPreferences] = useState<WarmupPreferences>(() => voicePreferences('baritone'));
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [storageError, setStorageError] = useState('');
  const [details, setDetails] = useState(false);
  const [adjusting, setAdjusting] = useState<string | null>(null);
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
  const workoutRef = useRef(workout); workoutRef.current = workout;
  const completeRef = useRef(() => {});
  const startStepRef = useRef<(exercise: WarmupExercise, explanation?: boolean) => void>(() => {});
  const advanceRef = useRef(() => {});
  const voice = useWarmupAdvance(rest && workout ? `warmup:${workout.key}:${workout.index}` : null, voiceAdvance && Boolean(workout), () => advanceRef.current());
  const transition = useRef(0);
  const player = useRef<ReturnType<typeof createSongPlayback<WarmupTrack>> | null>(null);
  const saveChain = useRef(Promise.resolve());
  const storageKey = shareId ? `@teatro_ia_warmup_v1:${shareId}` : null;
  const current = tracks.find(track => track.key === selectedKey);
  const autoStarted = useRef<number | undefined>(undefined);
  const startFull = useRef(() => {});

  useEffect(() => () => { player.current?.destroy(); player.current = null; }, []);
  useEffect(() => {
    let cancelled = false;
    player.current?.stop(); setTracks([]); setWorkout(null); setRest(false); setLoadedKey(null); setPreferences(voicePreferences('baritone'));
    if (storageKey) void AsyncStorage.getItem(storageKey).then(value => {
      if (!cancelled && value) setPreferences(restoreWarmupPreferences(JSON.parse(value)));
    }).catch(() => { if (!cancelled) setStorageError('No se pudo recuperar tu ajuste de calentamiento.'); })
      .finally(() => { if (!cancelled) setLoadedKey(storageKey); });
    return () => { cancelled = true; };
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey || loadedKey !== storageKey) return;
    // Serialize writes so a slow earlier save cannot replace the latest range.
    saveChain.current = saveChain.current.catch(() => {}).then(() => AsyncStorage.setItem(storageKey, JSON.stringify(preferences))).catch(() => setStorageError('No se pudo guardar el ajuste en este dispositivo.'));
  }, [loadedKey, preferences, storageKey]);
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
    transition.current++; voice.stopRecognition(); player.current?.stop(); setTracks([]); workoutRef.current = null; setWorkout(null); setRest(false); setRetryStep(null); setLaunching(false); setError(''); setPreferences(next);
  };
  const adjust = (exercise: WarmupExercise, field: 'start' | 'low' | 'high', value: number) => change({
    ...preferences, exercises: { ...preferences.exercises, [exercise.id]: { ...preferences.exercises[exercise.id], [field]: value } },
  });
  const playStep = (exercise: WarmupExercise, explanation = true) => {
    try {
      const next = planWarmupExercise(exercise, preferences, explanation).tracks;
      if (!next.length) return;
      if (Platform.OS !== 'web') throw new Error('Abre el calentamiento en la interfaz web de AI-Theatre.');
      onBeforePlay(); setError(''); setTracks(next);
      if (!player.current) player.current = createSongPlayback<WarmupTrack>({ createAudio: createAudio || (() => new Audio()), onTrack: setSelectedKey, onPlaying: setPlaying,
        onPosition: setPosition, onDuration: setDuration, onQueue: setQueue, onError: setError, onComplete: () => completeRef.current() });
      player.current.stop();
      player.current.setRepeat(repeat && workoutRef.current?.exercises.length === 1 ? 'queue' : 'off');
      player.current.play(next[0], next, 'queue');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo preparar el calentamiento.'); }
  };
  startStepRef.current = playStep;
  completeRef.current = () => {
    const session = workoutRef.current;
    if (!session) return;
    if (session.index < session.exercises.length - 1) setRest(true);
    else {
      workoutRef.current = null; setWorkout(null); setRest(false); setError('');
      if (catalog && session.exercises.length === catalog.exercises.length && session.exercises.every((exercise, index) => exercise.id === catalog.exercises[index].id)) {
        vocalPractice.recordActivity(true);
        // Release handlers before the next owner starts on the shared element.
        if (autoStart !== undefined) { player.current?.destroy(); player.current = null; onComplete?.(); }
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
    setRetryStep(null); setLaunching(false); workoutRef.current = session; setWorkout(session);
    startStepRef.current(session.exercises[session.index], explanation);
  };
  const start = (exercises: WarmupExercise[], explanation = true) => {
    try {
      const ordered = [...exercises].sort((a, b) => a.sourceStart - b.sourceStart);
      ordered.forEach(exercise => planWarmupExercise(exercise, preferences, explanation));
      if (ordered.length > 1) setRepeat(false);
      const session = { exercises: ordered, index: 0, key: Date.now() };
      player.current?.stop(); setTracks([]);
      void releaseAndPlay(session, explanation);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Revisa el rango de los ejercicios.'); }
  };
  advanceRef.current = () => {
    const session = workoutRef.current;
    if (!rest || !session || session.index >= session.exercises.length - 1) return;
    void releaseAndPlay({ ...session, index: session.index + 1 });
  };
  const stop = () => { transition.current++; voice.stopRecognition(); player.current?.stop(); workoutRef.current = null; setWorkout(null); setRest(false); setRetryStep(null); setLaunching(false); };
  const skip = async () => {
    stop(); const token = transition.current; setLaunching(true);
    const ended = await voice.waitForRecognitionEnd();
    if (token !== transition.current) return;
    setLaunching(false);
    if (!ended) { setError('La escucha todavía se está cerrando. Vuelve a pulsar Ir directamente a cantar.'); return; }
    player.current?.destroy(); player.current = null;
    onSkip?.();
  };
  startFull.current = () => { if (catalog) start(catalog.exercises); };
  useEffect(() => {
    if (autoStart === undefined || autoStarted.current === autoStart || loading || catalog?.status !== 'complete' || loadedKey !== storageKey) return;
    autoStarted.current = autoStart; startFull.current();
  }, [autoStart, catalog, loadedKey, loading, storageKey]);
  useEffect(() => () => { transition.current++; }, []);

  return <View testID="warmup-library" style={{ gap: 20 }}>
    <View style={{ gap: 8 }}><Text style={ui.subtitle}>Calentamiento</Text><Text style={ui.text}>Vamos a preparar tu voz, paso a paso y dentro de tu rango cómodo.</Text></View>
    {onSkip ? <View testID="automatic-warmup" style={ui.card}><Text style={ui.subtitle}>Preparamos la voz antes de cantar</Text><Text style={ui.text}>Empezamos con el calentamiento. Después continuaremos con la canción que has elegido.</Text><Button label="Ir directamente a cantar" secondary disabled={launching} onPress={() => void skip()} /></View> : null}
    {loading ? <Text accessibilityLiveRegion="polite" style={ui.text}>Cargando calentamiento…</Text> : null}
    {loadError ? <View style={ui.card}><Text accessibilityRole="alert" style={ui.error}>{loadError}</Text><Button label="Reintentar calentamiento" secondary onPress={() => setRetry(value => value + 1)} /></View> : null}
    {!loading && !loadError && !catalog ? <View style={ui.card}><Text style={ui.subtitle}>Todavía no hay ejercicios preparados</Text><Text style={ui.text}>{shareId ? 'Los ejercicios aparecerán aquí cuando estén reconstruidos a partir de la referencia.' : 'Abre una obra compartida para acceder a sus audios desde tus dispositivos.'}</Text></View> : null}
    {isAdmin && shareId && Platform.OS === 'web' ? <View style={ui.card}><Text style={ui.label}>ADMINISTRACIÓN</Text><Text style={ui.text}>Importar los audios ya preparados para esta obra.</Text>
      <input aria-label="Importar paquete de calentamiento preparado" type="file" accept=".json,application/json" disabled={importing} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        setImporting(true); setImportMessage('Comprobando el paquete preparado…');
        void importPreparedWarmup(file, shareId, setImportMessage).then(saved => {
          stop(); setTracks([]); setCatalog(saved); setLoadError(''); setImportMessage('Calentamiento guardado y comprobado. Disponible en los dispositivos que abran esta obra.');
        }).catch(cause => setImportMessage(cause instanceof Error ? cause.message : 'No se pudo importar el calentamiento.')).finally(() => setImporting(false));
      }} />
      {importMessage ? <Text accessibilityLiveRegion="polite" style={ui.text}>{importMessage}</Text> : null}
    </View> : null}
    {catalog ? <>
      <View style={[ui.card, { backgroundColor: palette.soft }]}>
        <Text style={ui.label}>{catalog.status === 'pilot' ? 'PILOTO PARA CONTRASTAR' : 'CALENTAMIENTO PREPARADO'}</Text>
        <Text style={ui.text}>{catalog.exercises.length} de {catalog.exercises.length + catalog.pending.length} ejercicios preparados.{catalog.status === 'pilot' ? ' Empieza por el piloto y contrástalo con el vídeo. El resto sigue en reconstrucción.' : ''}</Text>
        <Button label="Hacer calentamiento completo" disabled={catalog.status !== 'complete' || loadedKey !== storageKey} onPress={() => start(catalog.exercises)} />
        <Text style={ui.text}>Te guiaré en cada ejercicio. Después del piano tendrás una pausa para beber. Cuando estés listo, di «siguiente» o «adelante», o pulsa Siguiente ejercicio. Tómate el tiempo que necesites.</Text>
        <Chip label="Continuar por voz durante los descansos" selected={voiceAdvance} onPress={() => setVoiceAdvance(value => !value)} />
        {!voice.isSupported && voiceAdvance ? <Text style={ui.text}>Este navegador no ofrece escucha de voz. Puedes continuar con el botón.</Text> : null}
      </View>
      <View style={ui.card}><Text style={ui.subtitle}>Tu tesitura y tu rango</Text>
        <View style={ui.wrap}>{WARMUP_VOICES.map(voice => <Chip key={voice.id} label={voice.label} selected={preferences.voice === voice.id} disabled={loadedKey !== storageKey} onPress={() => change(voicePreferences(voice.id))} />)}</View>
        <Text style={ui.text}>Cada cuerda es un punto de partida editable. Elige las notas que te resulten cómodas; la etiqueta no determina tu rango personal. Al elegir otra cuerda se restablecen sus valores de partida.</Text>
        <NoteControl label="Límite grave" value={preferences.low} disabled={loadedKey !== storageKey} onChange={low => change({ ...preferences, low })} />
        <NoteControl label="Límite agudo" value={preferences.high} disabled={loadedKey !== storageKey} onChange={high => change({ ...preferences, high })} />
        <Text style={ui.text}>Se recuerda en este dispositivo. Puedes ajustar por separado el inicio y los límites de cada ejercicio. Do4 = C4 = MIDI 60.</Text>
        {storageError ? <Text accessibilityRole="alert" style={ui.error}>{storageError}</Text> : null}
      </View>
      {rest && workout ? <View testID="warmup-rest" style={[ui.card, { backgroundColor: palette.soft }]}>
        <Text style={ui.subtitle}>Pausa para beber</Text><Text style={ui.text}>Has terminado {workout.exercises[workout.index].title}. A continuación: {workout.exercises[workout.index + 1]?.title}.</Text>
        <Text accessibilityLiveRegion="polite" style={ui.text}>{voiceAdvance && voice.isSupported ? voice.status === 'listening' ? 'Te escucho: di «siguiente» o «adelante» cuando estés listo.' : 'Preparando la escucha… También puedes continuar con el botón.' : 'Continúa cuando estés listo.'}</Text>
        {voice.error ? <><Text accessibilityRole="alert" style={ui.error}>{voice.error}</Text><Button label="Reintentar escucha del descanso" secondary onPress={voice.restartRecognition} /></> : null}
        <Button label="Siguiente ejercicio" onPress={() => advanceRef.current()} /><Button label="Detener calentamiento" secondary onPress={stop} />
      </View> : null}
      {launching ? <View style={ui.card}><Text style={ui.text}>Preparando el siguiente audio…</Text><Button label="Cancelar calentamiento" secondary onPress={stop} /></View> : null}
      {current && !rest && !launching && !retryStep ? <View testID="warmup-player" style={[ui.card, { backgroundColor: palette.soft }]}>
        {workout ? <Text style={ui.label}>Ejercicio {workout.index + 1} de {workout.exercises.length}</Text> : <Text style={ui.label}>Ejercicio terminado. Puedes repetirlo o iniciar otra selección.</Text>}
        <Text style={ui.label}>ESCUCHANDO</Text><Text style={ui.subtitle}>{current.title}</Text>
        <Text accessibilityLiveRegion="polite" style={ui.text}>{queue.index + 1} de {queue.total} · {current.phase === 'piano' ? 'Piano' : current.phase === 'tip' ? 'Consejo' : 'Explicación'}{repeat ? ' · En bucle' : ''}</Text>
        <View style={ui.row}><View style={{ flex: 1 }}><Button label={playing ? 'Pausar calentamiento' : 'Reanudar calentamiento'} onPress={() => { if (playing) player.current?.pause(); else player.current?.resume(); }} /></View><Button label="Detener" secondary onPress={stop} /></View>
        {Platform.OS === 'web' ? <input aria-label="Posición del audio de calentamiento" type="range" min={0} max={duration || 1} step={.1} value={position} style={{ width: '100%', accentColor: palette.plum, minHeight: 30 }} onChange={event => player.current?.seek(Number(event.target.value))} /> : null}
        <Text style={ui.text}>{sourceClock(position)} / {sourceClock(duration)} de este audio</Text>
        <Chip label="Repetir ejercicio o selección" selected={repeat} disabled={Boolean(workout && workout.exercises.length > 1)} onPress={() => setRepeat(value => !value)} />
      </View> : null}
      {error ? <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={ui.error}>{error}</Text>{retryStep ? <><Button label="Reintentar siguiente audio" onPress={() => void releaseAndPlay(retryStep.session, retryStep.explanation)} /><Button label="Cancelar calentamiento" secondary onPress={stop} /></> : current ? <Button label="Reintentar ejercicio" secondary onPress={() => {
        const exercise = catalog.exercises.find(item => item.id === current.exerciseId);
        if (exercise) start([exercise], tracks[0]?.phase === 'explanation');
      }} /> : null}</View> : null}
      {catalog.exercises.map(exercise => {
        const settings = exerciseSettings(exercise, preferences);
        let summary = '', problem = '';
        try { const plan = planWarmupExercise(exercise, preferences); summary = `${noteName(plan.low)}–${noteName(plan.high)} · ${plan.roots.length} recorridos`; }
        catch (cause) { problem = cause instanceof Error ? cause.message : 'Revisa el rango.'; }
        return <View key={exercise.id} style={ui.card}>
          <Text style={ui.subtitle}>{exercise.title}</Text><Text style={ui.text}>{exercise.objective}</Text>
          <Text style={ui.text}>Inicio: {noteName(settings.start)} · {summary || 'Rango pendiente de ajustar'}</Text>
          {problem ? <Text accessibilityRole="alert" style={ui.error}>{problem}</Text> : null}
          <Button label={`Escuchar explicación y piano · ${exercise.title}`} disabled={Boolean(problem) || loadedKey !== storageKey} onPress={() => start([exercise])} />
          <Button label={`Sólo piano · ${exercise.title}`} secondary disabled={Boolean(problem) || loadedKey !== storageKey} onPress={() => start([exercise], false)} />
          <Chip label="Repetir ejercicio" selected={repeat} disabled={Boolean(workout && workout.exercises.length > 1)} onPress={() => setRepeat(value => !value)} />
          <Chip label={adjusting === exercise.id ? 'Cerrar ajuste del ejercicio' : 'Ajustar este ejercicio'} selected={adjusting === exercise.id} onPress={() => setAdjusting(value => value === exercise.id ? null : exercise.id)} />
          {adjusting === exercise.id ? <View style={{ gap: 8 }}>
            <NoteControl label="Nota inicial" value={settings.start} onChange={value => adjust(exercise, 'start', value)} />
            <NoteControl label="Grave del ejercicio" value={settings.low} min={preferences.low} max={preferences.high} onChange={value => adjust(exercise, 'low', value)} />
            <NoteControl label="Agudo del ejercicio" value={settings.high} min={preferences.low} max={preferences.high} onChange={value => adjust(exercise, 'high', value)} />
            <Text style={ui.text}>Los límites de este ejercicio quedan dentro de tu rango general. Se acorta la subida antes de salir de ellos, conservando el patrón completo.</Text>
          </View> : null}
          <Text style={ui.text}>{exercise.instructions}</Text>
          {exercise.advice.map((tip, index) => <Text key={index} style={ui.text}>{tip.text}</Text>)}
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
