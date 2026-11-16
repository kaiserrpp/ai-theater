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

export const WarmupLibrary = ({ shareId, onBeforePlay }: { shareId: string | null; onBeforePlay: () => void }) => {
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
  const player = useRef<ReturnType<typeof createSongPlayback<WarmupTrack>> | null>(null);
  const saveChain = useRef(Promise.resolve());
  const storageKey = shareId ? `@teatro_ia_warmup_v1:${shareId}` : null;
  const current = tracks.find(track => track.key === selectedKey);

  useEffect(() => () => { player.current?.destroy(); player.current = null; }, []);
  useEffect(() => {
    let cancelled = false;
    player.current?.stop(); setTracks([]); setLoadedKey(null); setPreferences(voicePreferences('baritone'));
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
  useEffect(() => { player.current?.setRepeat(repeat ? 'queue' : 'off'); }, [repeat]);

  const change = (next: WarmupPreferences) => {
    player.current?.stop(); setTracks([]); setError(''); setPreferences(next);
  };
  const adjust = (exercise: WarmupExercise, field: 'start' | 'low' | 'high', value: number) => change({
    ...preferences, exercises: { ...preferences.exercises, [exercise.id]: { ...preferences.exercises[exercise.id], [field]: value } },
  });
  const start = (exercises: WarmupExercise[], explanation = true) => {
    try {
      const next = exercises.flatMap(exercise => planWarmupExercise(exercise, preferences, explanation).tracks);
      if (!next.length) return;
      if (Platform.OS !== 'web') throw new Error('Abre el calentamiento en la interfaz web de AI-Theatre.');
      onBeforePlay(); setError(''); setTracks(next);
      if (!player.current) player.current = createSongPlayback<WarmupTrack>({ createAudio: () => new Audio(), onTrack: setSelectedKey, onPlaying: setPlaying,
        onPosition: setPosition, onDuration: setDuration, onQueue: setQueue, onError: setError });
      player.current.stop();
      player.current.setRepeat(repeat ? 'queue' : 'off');
      player.current.play(next[0], next, 'queue');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo preparar el calentamiento.'); }
  };

  return <View testID="warmup-library" style={{ gap: 20 }}>
    <View style={{ gap: 8 }}><Text style={ui.subtitle}>Calentamiento</Text><Text style={ui.text}>Explicación en español y piano preparado para tu rango.</Text></View>
    {loading ? <Text accessibilityLiveRegion="polite" style={ui.text}>Cargando calentamiento…</Text> : null}
    {loadError ? <View style={ui.card}><Text accessibilityRole="alert" style={ui.error}>{loadError}</Text><Button label="Reintentar calentamiento" secondary onPress={() => setRetry(value => value + 1)} /></View> : null}
    {!loading && !loadError && !catalog ? <View style={ui.card}><Text style={ui.subtitle}>Todavía no hay ejercicios preparados</Text><Text style={ui.text}>{shareId ? 'Los ejercicios aparecerán aquí cuando estén reconstruidos a partir de la referencia.' : 'Abre una obra compartida para acceder a sus audios desde tus dispositivos.'}</Text></View> : null}
    {isAdmin && shareId && Platform.OS === 'web' ? <View style={ui.card}><Text style={ui.label}>ADMINISTRACIÓN</Text><Text style={ui.text}>Importar los audios ya preparados para esta obra.</Text>
      <input aria-label="Importar paquete de calentamiento preparado" type="file" accept=".json,application/json" disabled={importing} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        setImporting(true); setImportMessage('Comprobando el paquete preparado…');
        void importPreparedWarmup(file, shareId, setImportMessage).then(saved => {
          player.current?.stop(); setTracks([]); setCatalog(saved); setLoadError(''); setImportMessage('Calentamiento guardado y comprobado. Disponible en los dispositivos que abran esta obra.');
        }).catch(cause => setImportMessage(cause instanceof Error ? cause.message : 'No se pudo importar el calentamiento.')).finally(() => setImporting(false));
      }} />
      {importMessage ? <Text accessibilityLiveRegion="polite" style={ui.text}>{importMessage}</Text> : null}
    </View> : null}
    {catalog ? <>
      <View style={[ui.card, { backgroundColor: palette.soft }]}>
        <Text style={ui.label}>{catalog.status === 'pilot' ? 'PILOTO PARA CONTRASTAR' : 'CALENTAMIENTO PREPARADO'}</Text>
        <Text style={ui.text}>{catalog.exercises.length} de {catalog.exercises.length + catalog.pending.length} ejercicios preparados.{catalog.status === 'pilot' ? ' Empieza por el piloto y contrástalo con el vídeo. El resto sigue en reconstrucción.' : ''}</Text>
        <Button label="Hacer calentamiento completo" disabled={catalog.status !== 'complete' || loadedKey !== storageKey} onPress={() => start(catalog.exercises)} />
      </View>
      <View style={ui.card}><Text style={ui.subtitle}>Tu tesitura y tu rango</Text>
        <View style={ui.wrap}>{WARMUP_VOICES.map(voice => <Chip key={voice.id} label={voice.label} selected={preferences.voice === voice.id} disabled={loadedKey !== storageKey} onPress={() => change(voicePreferences(voice.id))} />)}</View>
        <Text style={ui.text}>Cada cuerda es un punto de partida editable. Elige las notas que te resulten cómodas; la etiqueta no determina tu rango personal. Al elegir otra cuerda se restablecen sus valores de partida.</Text>
        <NoteControl label="Límite grave" value={preferences.low} disabled={loadedKey !== storageKey} onChange={low => change({ ...preferences, low })} />
        <NoteControl label="Límite agudo" value={preferences.high} disabled={loadedKey !== storageKey} onChange={high => change({ ...preferences, high })} />
        <Text style={ui.text}>Se recuerda en este dispositivo. Puedes ajustar por separado el inicio y los límites de cada ejercicio. Do4 = C4 = MIDI 60.</Text>
        {storageError ? <Text accessibilityRole="alert" style={ui.error}>{storageError}</Text> : null}
      </View>
      {current ? <View testID="warmup-player" style={[ui.card, { backgroundColor: palette.soft }]}>
        <Text style={ui.label}>ESCUCHANDO</Text><Text style={ui.subtitle}>{current.title}</Text>
        <Text accessibilityLiveRegion="polite" style={ui.text}>{queue.index + 1} de {queue.total} · {current.phase === 'piano' ? 'Piano' : current.phase === 'tip' ? 'Consejo' : 'Explicación'}{repeat ? ' · En bucle' : ''}</Text>
        <View style={ui.row}><View style={{ flex: 1 }}><Button label={playing ? 'Pausar calentamiento' : 'Reanudar calentamiento'} onPress={() => { if (playing) player.current?.pause(); else player.current?.resume(); }} /></View><Button label="Detener" secondary onPress={() => player.current?.stop()} /></View>
        {Platform.OS === 'web' ? <input aria-label="Posición del audio de calentamiento" type="range" min={0} max={duration || 1} step={.1} value={position} style={{ width: '100%', accentColor: palette.plum, minHeight: 30 }} onChange={event => player.current?.seek(Number(event.target.value))} /> : null}
        <Text style={ui.text}>{sourceClock(position)} / {sourceClock(duration)} de este audio</Text>
        <Chip label="Repetir ejercicio o selección" selected={repeat} onPress={() => setRepeat(value => !value)} />
      </View> : null}
      {error ? <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={ui.error}>{error}</Text>{current ? <Button label="Reintentar ejercicio" secondary onPress={() => {
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
          <Chip label="Repetir ejercicio" selected={repeat} onPress={() => setRepeat(value => !value)} />
          <Chip label={adjusting === exercise.id ? 'Cerrar ajuste del ejercicio' : 'Ajustar este ejercicio'} selected={adjusting === exercise.id} onPress={() => setAdjusting(value => value === exercise.id ? null : exercise.id)} />
          {adjusting === exercise.id ? <View style={{ gap: 8 }}>
            <NoteControl label="Nota inicial" value={settings.start} onChange={value => adjust(exercise, 'start', value)} />
            <NoteControl label="Grave del ejercicio" value={settings.low} min={preferences.low} max={preferences.high} onChange={value => adjust(exercise, 'low', value)} />
            <NoteControl label="Agudo del ejercicio" value={settings.high} min={preferences.low} max={preferences.high} onChange={value => adjust(exercise, 'high', value)} />
            <Text style={ui.text}>Los límites de este ejercicio quedan dentro de tu rango general. Se acorta la subida antes de salir de ellos, conservando el patrón completo.</Text>
          </View> : null}
          <Text style={ui.label}>REFERENCIA · {sourceClock(exercise.sourceStart)}–{sourceClock(exercise.sourceEnd)}</Text>
          <Text style={ui.text}>{exercise.instructions}</Text>
          {exercise.advice.map((tip, index) => <Text key={index} style={ui.text}>{sourceClock(tip.sourceAt)} · {tip.text}</Text>)}
          <Text style={ui.text}>{exercise.score.description} · {exercise.score.tempoBpm} negras/min. Entrada de {exercise.score.preparationBeats} pulsos y cierre de {exercise.score.closingBeats} pulso. {exercise.score.progressionDescription}</Text>
          {exercise.uncertainties.map((uncertainty, index) => <Text key={index} style={ui.text}>Por contrastar: {uncertainty}</Text>)}
        </View>;
      })}
      <Chip label={details ? 'Ocultar revisión del vídeo' : 'Ver revisión y ejercicios pendientes'} selected={details} onPress={() => setDetails(value => !value)} />
      {details ? <View style={ui.card}><Text style={ui.subtitle}>Referencia y reconstrucción</Text>
        <Text style={ui.text}>Vídeo de {sourceClock(catalog.source.durationSeconds)}. La transcripción automática se ha usado como apoyo y contiene errores. Las dudas siguen abiertas. El vídeo original no se ha publicado en la app.</Text>
        {catalog.pending.map((item, index) => <View key={index} style={{ gap: 4 }}><Text style={[ui.text, { color: palette.ink, fontWeight: '600' }]}>{sourceClock(item.sourceStart)}–{sourceClock(item.sourceEnd)} · {item.title}</Text><Text style={ui.text}>{item.note}</Text></View>)}
        {catalog.credits.map(credit => <TouchableOpacity key={credit.url} accessibilityRole="link" onPress={() => void Linking.openURL(credit.url)}><Text style={[ui.text, { color: palette.plum, textDecorationLine: 'underline' }]}>{credit.label}</Text></TouchableOpacity>)}
      </View> : null}
    </> : null}
  </View>;
};
