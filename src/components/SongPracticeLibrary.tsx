import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeRoles } from '../../shared/musicalAuditions';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SharedMusicalAudition, SharedScriptManifest, SharedSongAudioAsset } from '../types/sharedScript';
import { useIsAdmin } from '../store/adminSession';
import { createSongPlayback, type SongPlaybackMode, type SongRepeatMode } from '../utils/songPlayback';
import { selectSongPlaylist, type SongPlaylistKind } from '../utils/songPlaylistSelection';
import { MusicalAuditionEditor } from './MusicalAuditionEditor';
import { Button, Chip, Disclosure, Icon, Sheet, usePracticeTheme } from './PracticeUI';
import { WarmupLibrary } from './WarmupLibrary';
import { useVocalPractice, vocalPractice } from '../store/vocalPractice';
import { primeSongPracticeAudio } from '../utils/songPracticeAudio';

type Track = { key: string; title: string; lyrics: string; audio: SharedSongAudioAsset; auditionId?: string; numberTitle?: string };
type SingingRequest = { id: number; trackKey: string; queueKeys: string[]; mode: SongPlaybackMode; position: number; repeat?: SongRepeatMode };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export const SongPracticeLibrary = ({ manifest, active, onUpdated, onManageWork, onOpen, defaultRoles, openEditorRequest = 0, onActivityChange }: {
  manifest: SharedScriptManifest | null; active: boolean; defaultRoles: string[]; openEditorRequest?: number;
  onUpdated: (manifest: SharedScriptManifest) => void; onManageWork: () => void;
  onOpen?: () => void;
  onActivityChange?: (busy: boolean) => void;
}) => {
  const { palette, ui } = usePracticeTheme();
  const isAdmin = useIsAdmin();
  const [scope, setScope] = useState<'auditions' | 'work'>('auditions');
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const scopeKey = manifest ? `@teatro_ia_music_scope:${manifest.shareId}` : null;
  useEffect(() => {
    let cancelled = false; setLoadedScope(null);
    if (scopeKey) void AsyncStorage.getItem(scopeKey).then(value => {
      if (!cancelled) setScope(value === 'work' ? 'work' : 'auditions');
    }).catch(() => {}).finally(() => { if (!cancelled) setLoadedScope(scopeKey); });
    return () => { cancelled = true; };
  }, [scopeKey]);
  useEffect(() => { if (scopeKey && scopeKey === loadedScope) void AsyncStorage.setItem(scopeKey, scope).catch(() => {}); }, [scopeKey, loadedScope, scope]);
  const [warmupOpen, setWarmupOpen] = useState(false);
  const activity = useVocalPractice();
  const [pendingSinging, setPendingSinging] = useState<SingingRequest | null>(null);
  const pendingSingingRef = useRef(pendingSinging); pendingSingingRef.current = pendingSinging;
  const requestVersion = useRef(0);
  const sharedAudio = useRef<HTMLAudioElement | null>(null);
  const singing = useRef(false);
  const seekWhenReady = useRef<{ seconds: number; src: string } | null>(null);
  const restorePosition = useRef(() => {});
  const activeQueue = useRef<Track[]>([]);
  const getAudio = () => {
    if (!sharedAudio.current) { sharedAudio.current = new Audio(); sharedAudio.current.oncanplay = () => restorePosition.current(); }
    return sharedAudio.current;
  };
  const [mine, setMine] = useState(false);
  const [musicRoles, setMusicRoles] = useState<string[]>([]);
  const [loadedRolesKey, setLoadedRolesKey] = useState<string | null>(null);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [editor, setEditor] = useState<{ initial: SharedMusicalAudition | null; key: number } | null>(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const handledEditorRequest = useRef(0);
  const defaultRolesRef = useRef(defaultRoles);
  defaultRolesRef.current = defaultRoles;
  const scroll = useRef<ScrollView | null>(null);
  const rolesKey = manifest ? `@teatro_ia_music_roles:${manifest.shareId}` : null;
  useEffect(() => {
    let cancelled = false; setLoadedRolesKey(null); setEditor(null); setQuery('');
    if (rolesKey) void AsyncStorage.getItem(rolesKey).then((stored) => {
      if (!cancelled) setMusicRoles(normalizeRoles(stored ? JSON.parse(stored) : defaultRolesRef.current));
    }).catch(() => { if (!cancelled) setMusicRoles(defaultRolesRef.current); }).finally(() => { if (!cancelled) setLoadedRolesKey(rolesKey); });
    return () => { cancelled = true; };
  }, [rolesKey]);
  useEffect(() => {
    if (rolesKey && loadedRolesKey === rolesKey) void AsyncStorage.setItem(rolesKey, JSON.stringify(musicRoles)).catch(() => {});
  }, [loadedRolesKey, musicRoles, rolesKey]);
  useEffect(() => {
    if (manifest && openEditorRequest > handledEditorRequest.current) {
      handledEditorRequest.current = openEditorRequest; setScope('auditions'); setWarmupOpen(false);
      setEditor({ initial: null, key: Date.now() });
    }
  }, [manifest, openEditorRequest]);
  const availableRoles = normalizeRoles([...(manifest?.scriptData.personajes || []), ...(manifest?.auditionScenes || []).flatMap((scene) => scene.scriptData.personajes), ...(manifest?.musicalAuditions || []).flatMap((cut) => cut.roles)]);
  const openEditor = (initial: SharedMusicalAudition | null = null) => {
    player.current?.pause(); setNotice(''); setEditor({ initial, key: Date.now() });
  };
  const visibleCuts = (manifest?.musicalAuditions || []).filter((cut) => {
    const roleKeys = musicRoles.map((role) => role.toLocaleLowerCase('es'));
    if (mine && !cut.roles.some((role) => roleKeys.includes(role.toLocaleLowerCase('es')))) return false;
    const title = manifest?.musicalNumbers.find((number) => number.id === cut.musicalNumberId)?.title || '';
    return `${cut.title} ${title} ${cut.roles.join(' ')}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'));
  });
  const tracks = useMemo(() => {
    const result: Track[] = [];
    const used = new Set<string>();
    manifest?.musicalNumbers.forEach((number) => {
      const songs = manifest.songs.filter((song) => number.songIds.includes(song.id));
      const audios = [...number.audios, ...songs.flatMap((song) => song.audios)];
      audios.forEach((audio) => {
        if (used.has(audio.id)) return;
        used.add(audio.id);
        result.push({ key: audio.id, title: number.title, lyrics: songs.map((song) => song.lyrics).filter(Boolean).join('\n\n'), audio });
      });
    });
    manifest?.songs.forEach((song) => song.audios.forEach((audio) => {
      if (used.has(audio.id)) return;
      used.add(audio.id);
      result.push({ key: audio.id, title: song.title, lyrics: song.lyrics, audio });
    }));
    manifest?.musicalAuditions?.forEach((cut) => cut.audios.forEach((audio) => result.push({
      key: `audition:${cut.id}:${audio.id}`, title: cut.title, lyrics: cut.lyrics, audio, auditionId: cut.id,
      numberTitle: manifest.musicalNumbers.find((number) => number.id === cut.musicalNumberId)?.title,
    })));
    return result;
  }, [manifest]);
  const [kind, setKind] = useState<SongPlaylistKind>('all');
  const [playbackMode, setPlaybackMode] = useState<SongPlaybackMode>('single');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { onActivityChange?.(playing || (active && warmupOpen)); return () => onActivityChange?.(false); }, [playing, active, warmupOpen, onActivityChange]);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [repeatMode, setRepeatMode] = useState<SongRepeatMode>('queue');
  const [queueInfo, setQueueInfo] = useState({ index: -1, total: 0 });
  const [rate, setRate] = useState(1);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [error, setError] = useState('');
  const player = useRef<ReturnType<typeof createSongPlayback<Track>> | null>(null);
  const selected = tracks.find((track) => track.key === selectedKey) ?? null;
  const playlist = (playlistKind: SongPlaylistKind, playlistScope = scope) => selectSongPlaylist(tracks, {
    scope: playlistScope, kind: playlistKind, visibleAuditionIds: visibleCuts.map((cut) => cut.id),
  });
  const visibleTracks = playlist(kind, 'work');
  const tracksRef = useRef(tracks); tracksRef.current = tracks;

  useEffect(() => () => {
    requestVersion.current++; pendingSingingRef.current = null; player.current?.destroy(); player.current = null;
    if (sharedAudio.current) { sharedAudio.current.pause(); sharedAudio.current.oncanplay = null; }
  }, []);
  useEffect(() => {
    if (!active && pendingSingingRef.current) { requestVersion.current++; pendingSingingRef.current = null; setPendingSinging(null); setWarmupOpen(false); }
  }, [active]);
  useEffect(() => { player.current?.setRepeat(repeatMode); player.current?.setRate(rate); }, [repeatMode, rate]);
  useEffect(() => {
    requestVersion.current++; pendingSingingRef.current = null; setPendingSinging(null); setWarmupOpen(false);
    player.current?.stop(); setSelectedKey(null); setPlaying(false); setPosition(0); setDuration(0); setError('');
  }, [manifest?.shareId]);
  useEffect(() => {
    player.current?.updateTracks(tracks);
  }, [tracks]);

  const startPlayback = (track: Track, queue: Track[], mode: SongPlaybackMode, repeatOverride?: SongRepeatMode) => {
    setError('');
    if (Platform.OS !== 'web') { void Linking.openURL(track.audio.audioUrl); return; }
    if (!player.current) {
      player.current = createSongPlayback<Track>({ createAudio: getAudio, onTrack: setSelectedKey, onPlaying: value => {
        if (value || singing.current) vocalPractice.recordActivity(true);
        singing.current = value; setPlaying(value);
      }, onPosition: seconds => { setPosition(seconds); if (singing.current && seconds > 0) vocalPractice.recordActivity(); }, onDuration: seconds => {
        setDuration(seconds);
        const audio = sharedAudio.current;
        if (audio && seconds > 0) restorePosition.current();
      }, onQueue: setQueueInfo, onError: setError });
      player.current.setRate(rate);
    }
    const nextRepeat = repeatOverride ?? (repeatMode === 'off' ? 'off' : mode === 'single' ? 'track' : 'queue');
    activeQueue.current = queue;
    setPlaybackMode(mode); setRepeatMode(nextRepeat); player.current.setRepeat(nextRepeat);
    player.current.play(track, queue, mode);
  };
  const startRequestedSong = (request: SingingRequest) => {
    const available = new Map(tracksRef.current.map(track => [track.key, track]));
    const track = available.get(request.trackKey);
    if (!track) { setError('La canción elegida ya no está disponible. Elige otra canción.'); return; }
    seekWhenReady.current = request.position > 0 ? { seconds: request.position, src: track.audio.audioUrl } : null;
    startPlayback(track, request.queueKeys.flatMap(key => available.has(key) ? [available.get(key)!] : []), request.mode, request.repeat);
  };
  restorePosition.current = () => {
    const target = seekWhenReady.current, audio = sharedAudio.current;
    if (!target || !audio || audio.readyState < 3 || audio.currentSrc !== target.src) return;
    seekWhenReady.current = null; player.current?.seek(target.seconds);
  };
  const finishWarmup = () => {
    const request = pendingSingingRef.current;
    pendingSingingRef.current = null; setPendingSinging(null); setWarmupOpen(false);
    if (request) startRequestedSong(request);
  };
  const requestSong = (track: Track, queue: Track[], mode: SongPlaybackMode, at = 0, repeat?: SongRepeatMode) => {
    if (singing.current && sharedAudio.current && !sharedAudio.current.paused) vocalPractice.recordActivity(true);
    const request: SingingRequest = { id: ++requestVersion.current, trackKey: track.key, queueKeys: queue.map(entry => entry.key), mode, position: at, repeat };
    const decide = () => {
      if (request.id !== requestVersion.current) return;
      if (!vocalPractice.due() || !manifest?.shareId) { startRequestedSong(request); return; }
      player.current?.destroy(); player.current = null; singing.current = false; setPlaying(false);
      pendingSingingRef.current = request; setPendingSinging(request); setWarmupOpen(true); onOpen?.();
      scroll.current?.scrollTo({ y: 0, animated: true });
    };
    if (Platform.OS === 'web' && (!activity.loaded || vocalPractice.due()) && manifest?.shareId) {
      // Unlock the same element in the tap, before async loading or mounting.
      player.current?.destroy(); player.current = null; singing.current = false; setPlaying(false);
      primeSongPracticeAudio(getAudio());
    }
    if (activity.loaded) decide(); else void vocalPractice.load().then(decide);
  };
  const play = (track: Track) => {
    const queue = track.auditionId ? playlist(track.audio.kind, 'auditions') : visibleTracks;
    requestSong(track, queue, 'single');
  };
  const playGroup = (value: SongPlaylistKind) => {
    const queue = playlist(value);
    if (!queue.length) return;
    setKind(value); requestSong(queue[0], queue, 'queue');
    scroll.current?.scrollTo({ y: 0, animated: true });
  };
  const toggle = () => {
    if (playing) player.current?.pause();
    else if (selected) {
      if (activity.loaded && !vocalPractice.due() && player.current) player.current.resume();
      else requestSong(selected, activeQueue.current, playbackMode, player.current && sharedAudio.current ? sharedAudio.current.currentTime : position, repeatMode);
    }
  };
  const navigate = (direction: 'previous' | 'next') => {
    if (!selected || activeQueue.current.length < 2) return;
    const queue = activeQueue.current, index = queue.findIndex(track => track.key === selected.key);
    requestSong(queue[(index + (direction === 'next' ? 1 : -1) + queue.length) % queue.length], queue, playbackMode, 0, repeatMode);
  };
  const showSongs = (nextScope: typeof scope) => {
    requestVersion.current++; pendingSingingRef.current = null; setPendingSinging(null); setWarmupOpen(false); setScope(nextScope);
  };

  if (!active) return selected ? <View style={[ui.header, { backgroundColor: palette.soft, gap: 6, paddingHorizontal: 16 }]}>
    <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: palette.ink, fontWeight: '600' }}>{selected.title}</Text><Text numberOfLines={1} style={ui.text}>{selected.audio.label}</Text></View>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Canción anterior" disabled={queueInfo.total < 2} onPress={() => navigate('previous')} style={[ui.icon, { width: 36 }, queueInfo.total < 2 && { opacity: 0.4 }]}><Icon name="skip-previous" /></TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={playing ? 'Pausar canción' : 'Reproducir canción'} onPress={toggle} style={ui.icon}><Icon name={playing ? 'pause' : 'play'} /></TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Canción siguiente" disabled={queueInfo.total < 2} onPress={() => navigate('next')} style={[ui.icon, { width: 36 }, queueInfo.total < 2 && { opacity: 0.4 }]}><Icon name="skip-next" /></TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cerrar reproductor" onPress={() => player.current?.stop()} style={[ui.icon, { width: 36 }]}><Icon name="close" /></TouchableOpacity>
  </View> : null;

  return <>
    <ScrollView ref={scroll} contentContainerStyle={[ui.page, { gap: 14, paddingTop: 14 }]}>
    <View style={ui.row}><Text style={[ui.title, { flex: 1 }]}>Canciones</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Opciones de canciones" onPress={() => setOptionsOpen(true)} style={ui.icon}><Icon name="tune-variant" /></TouchableOpacity></View>
    <View style={ui.wrap}><Chip label="Audiciones" selected={!warmupOpen && scope === 'auditions'} onPress={() => showSongs('auditions')} /><Chip label="Obra" selected={!warmupOpen && scope === 'work'} onPress={() => showSongs('work')} /><Chip label="Calentamiento" selected={warmupOpen} onPress={() => { player.current?.stop(); setWarmupOpen(true); }} /></View>
    {warmupOpen ? <WarmupLibrary key={manifest?.shareId || 'local'} shareId={manifest?.shareId || null} createAudio={getAudio} autoStart={pendingSinging?.id} onComplete={finishWarmup} onSkip={pendingSinging ? finishWarmup : undefined} onBeforePlay={() => player.current?.stop()} /> : <>
    {scope === 'auditions' ? <>
      {notice ? <Text accessibilityLiveRegion="polite" style={[ui.text, { color: palette.green }]}>{notice}</Text> : null}
      <View style={ui.wrap}><Chip label="Todas" selected={!mine} onPress={() => setMine(false)} /><Chip label="Mis personajes" selected={mine} onPress={() => { setMine(true); if (!musicRoles.length) setRolesOpen(true); }} /><TouchableOpacity accessibilityRole="button" accessibilityLabel="Elegir personajes" onPress={() => setRolesOpen(true)} style={ui.icon}><Icon name="account-cog-outline" /></TouchableOpacity></View>
      {mine && musicRoles.length ? <Text style={ui.text}>{musicRoles.join(' · ')}</Text> : null}
      {(manifest?.musicalAuditions?.length || 0) > 4 ? <TextInput accessibilityLabel="Buscar audición musical" placeholder="Buscar canción, fragmento o personaje" placeholderTextColor={palette.sub} value={query} onChangeText={setQuery} style={{ padding: 12, fontSize: 16, borderRadius: 12, borderWidth: 1, borderColor: palette.rule, color: palette.ink }} /> : null}
    </> : null}
    <View testID="song-playlist-actions"><Disclosure title="Reproducir grupo" summary={kind === 'karaoke' ? 'Karaoke' : kind === 'vocal_guide' ? 'Con voz' : undefined}><View style={ui.wrap}>
      {([['all', 'Todas', 'Reproducir todas las canciones'], ['vocal_guide', 'Vocal guide', 'Reproducir vocal guides'], ['karaoke', 'Karaoke', 'Reproducir karaokes']] as const).map(([value, label, accessibilityLabel]) => <Chip key={value} label={`▶ ${label}`} accessibilityLabel={accessibilityLabel} selected={Boolean(selected) && kind === value && playbackMode === 'queue' && (selected?.auditionId ? 'auditions' : 'work') === scope} disabled={!playlist(value).length} onPress={() => playGroup(value)} />)}
    </View></Disclosure></View>

    {selected ? <View style={[ui.card, { backgroundColor: palette.soft, borderColor: palette.soft }]}>
      <View style={ui.row}><Text style={[ui.subtitle, { flex: 1 }]}>{selected.title}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Cerrar reproductor" onPress={() => player.current?.stop()} style={ui.icon}><Icon name="close" size={20} /></TouchableOpacity></View><Text style={ui.text}>{selected.numberTitle ? `${selected.numberTitle} · ` : ''}{selected.audio.label}</Text>
      <Text testID="song-queue-status" accessibilityLiveRegion="polite" style={ui.text}>{queueInfo.index + 1} de {queueInfo.total} · {playbackMode === 'single' ? 'Solo esta canción' : repeatMode === 'queue' ? 'Cola en bucle' : repeatMode === 'track' ? 'Una canción en bucle' : 'La cola termina al llegar al final'}</Text>
      {selected.auditionId ? <View style={ui.row}>{([['vocal_guide','Con voz'],['karaoke','Karaoke']] as const).map(([audioKind,label]) => {
        const track = tracks.find((candidate) => candidate.auditionId === selected.auditionId && candidate.audio.kind === audioKind);
        return <View key={audioKind} style={{flex:1}}><Button label={label} secondary={selected.audio.kind !== audioKind} disabled={!track} onPress={() => { if (track) play(track); }} /></View>;
      })}</View> : null}
      <View style={[ui.row, { justifyContent: 'space-between', gap: 0 }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Canción anterior" disabled={queueInfo.total < 2} onPress={() => navigate('previous')} style={[ui.icon, { width: 44 }, queueInfo.total < 2 && { opacity: 0.4 }]}><Icon name="skip-previous" size={30} /></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retroceder diez segundos" style={[ui.icon, { width: 44 }]} onPress={() => player.current?.seek(position - 10)}><Icon name="rewind-10" size={26} /></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={playing ? 'Pausar canción' : 'Reproducir canción'} onPress={toggle} style={[ui.icon, { width: 60, height: 60, backgroundColor: palette.button }]}><Icon name={playing ? 'pause' : 'play'} color={palette.onButton} size={32} /></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Avanzar diez segundos" style={[ui.icon, { width: 44 }]} onPress={() => player.current?.seek(position + 10)}><Icon name="fast-forward-10" size={26} /></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Canción siguiente" disabled={queueInfo.total < 2} onPress={() => navigate('next')} style={[ui.icon, { width: 44 }, queueInfo.total < 2 && { opacity: 0.4 }]}><Icon name="skip-next" size={30} /></TouchableOpacity>
      </View>
      {Platform.OS === 'web' ? <input aria-label="Posición de la canción" type="range" min={0} max={duration || 1} step={0.1} value={position} style={{ width: '100%', accentColor: palette.plum, minHeight: 30 }} onChange={(event) => player.current?.seek(Number(event.target.value))} /> : null}
      <View style={[ui.row, { justifyContent: 'space-between' }]}><Text style={ui.text}>{clock(position)}</Text><Text style={ui.text}>{clock(duration)}</Text></View>
      <Disclosure title="Velocidad y repetición" summary={`${rate.toFixed(2).replace('.', ',')}×${repeatMode !== 'off' ? ' · Repetición activada' : ''}`}>
      <View testID="song-speed-control" style={{ gap: 4 }}>
        <View style={[ui.row, { justifyContent: 'space-between' }]}><Text style={ui.text}>Velocidad · {rate.toFixed(2).replace('.', ',')}×</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Restablecer velocidad normal" onPress={() => setRate(1)} style={[ui.icon, { width: 44 }]}><Text style={{ color: palette.plum, fontWeight: '700' }}>1×</Text></TouchableOpacity></View>
        {Platform.OS === 'web' ? <input aria-label="Velocidad de reproducción" aria-valuetext={`${rate.toFixed(2).replace('.', ',')} veces la velocidad normal`} type="range" min={0.7} max={1} step={0.05} value={rate} style={{ width: '100%', accentColor: palette.plum, minHeight: 30 }} onChange={(event) => setRate(Number(event.target.value))} /> : null}
        <View style={[ui.row, { justifyContent: 'space-between' }]}><Text style={[ui.text, { fontSize: 12 }]}>0,70× · Más despacio</Text><Text style={[ui.text, { fontSize: 12 }]}>1× · Normal</Text></View>
      </View>
      <View style={ui.wrap}>{playbackMode === 'queue' ? <Chip label="Repetir cola" selected={repeatMode === 'queue'} onPress={() => setRepeatMode(repeatMode === 'queue' ? 'off' : 'queue')} /> : null}<Chip label="Repetir canción" selected={repeatMode === 'track'} onPress={() => setRepeatMode(repeatMode === 'track' ? playbackMode === 'queue' ? 'queue' : 'off' : 'track')} /></View>
      </Disclosure>
      {selected.lyrics ? <Chip label={lyricsOpen ? 'Ocultar letra' : 'Ver letra'} selected={lyricsOpen} onPress={() => setLyricsOpen(!lyricsOpen)} /> : null}
      {lyricsOpen && selected.lyrics ? <Text selectable style={[ui.text, { color: palette.ink }]}>{selected.lyrics}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={ui.error}>{error}</Text> : null}
    </View> : null}
    {scope === 'auditions' ? <>
      {!visibleCuts.length ? <View style={ui.card}><Icon name="music-note-outline" size={32} /><Text style={ui.subtitle}>{mine ? 'No hay fragmentos para estos personajes' : 'Canciones para tus audiciones'}</Text><Text style={ui.text}>{mine ? 'Puedes cambiar tus personajes o ver todas las audiciones.' : 'Añade un fragmento, sus personajes y los audios con voz y karaoke. Aparecerán aquí para practicar.'}</Text></View> : null}
      {visibleCuts.map((cut) => <View key={cut.id} style={ui.card}>
        <View style={ui.row}><View style={{ flex: 1, gap: 6 }}><Text style={ui.label}>{manifest?.musicalNumbers.find((number) => number.id === cut.musicalNumberId)?.title || 'Número musical'}</Text><Text style={ui.subtitle}>{cut.title}</Text><Text style={ui.text}>{cut.roles.join(' · ')}</Text></View>
          {isAdmin ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Editar ${cut.title}`} onPress={() => openEditor(cut)} style={ui.icon}><Icon name="pencil-outline" /></TouchableOpacity> : null}
        </View>
        {selected?.auditionId !== cut.id ? <View style={ui.row}>{([['vocal_guide','Con voz'],['karaoke','Karaoke']] as const).filter(([audioKind]) => kind === 'all' || audioKind === kind).map(([audioKind,label]) => {
          const track = tracks.find((candidate) => candidate.auditionId === cut.id && candidate.audio.kind === audioKind);
          return <View key={audioKind} style={{ flex: 1 }}><Button label={track ? label : `Sin ${label.toLowerCase()}`} secondary={selected?.auditionId !== cut.id || selected.audio.kind !== audioKind} disabled={!track} onPress={() => { if (track) { if (selectedKey === track.key && playing) toggle(); else play(track); scroll.current?.scrollTo({y:0,animated:true}); } }} /></View>;
        })}</View> : null}
        {!cut.audios.length ? <Text style={ui.text}>Fragmento preparado. Todavía faltan los audios.</Text> : null}
      </View>)}
    </> : <>
    {!visibleTracks.length ? <View style={ui.card}><Icon name="music-note-outline" size={32} /><Text style={ui.subtitle}>No hay audios {kind === 'karaoke' ? 'de karaoke' : kind === 'vocal_guide' ? 'con voz' : 'todavía'}</Text><Text style={ui.text}>Los materiales que se añadan a esta obra aparecerán aquí.</Text></View> : null}
    {visibleTracks.map((track) => <TouchableOpacity key={track.key} accessibilityRole="button" accessibilityLabel={`Escuchar ${track.title}, ${track.audio.label}`} onPress={() => play(track)} style={[ui.card, ui.row, { padding: 16 }, selectedKey === track.key && { borderColor: palette.plum }]}>
      <Icon name={selectedKey === track.key && playing ? 'volume-high' : 'play-circle-outline'} size={30} />
      <View style={{ flex: 1, gap: 4 }}><Text style={[ui.subtitle, { fontSize: 17 }]}>{track.title}</Text><Text style={ui.text}>{track.audio.label}{track.audio.guideRoles.length ? ` · ${track.audio.guideRoles.join(', ')}` : ''}</Text></View>
    </TouchableOpacity>)}
    </>}
    {selected && error ? <Button label="Reintentar audio" secondary onPress={() => play(selected)} /> : null}
    </>}
    </ScrollView>
    <Sheet title="Opciones de canciones" visible={optionsOpen} onClose={() => setOptionsOpen(false)}>
      <Chip label="Calentar antes de cantar" selected={activity.enabled} disabled={!activity.loaded} onPress={() => vocalPractice.setEnabled(!activity.enabled)} />
      <Text style={ui.text}>Calentamiento automático si llevas más de dos horas sin cantar. Siempre puedes omitirlo.</Text>
      {activity.error ? <Text style={ui.error}>{activity.error}</Text> : null}
      <Button label="+ Subir canción de audición" disabled={!manifest} onPress={() => { setOptionsOpen(false); openEditor(); }} />
      <Button label="Gestionar audios de la obra" secondary disabled={!manifest} onPress={() => { setOptionsOpen(false); onManageWork(); }} />
    </Sheet>
    <Sheet title="Mis personajes · Canciones" visible={rolesOpen} onClose={() => setRolesOpen(false)}>
      <Text style={ui.text}>Esta selección se recuerda para las canciones de esta obra en este dispositivo.</Text><View style={ui.wrap}>{availableRoles.map((role) => <Chip key={role} label={role} selected={musicRoles.includes(role)} onPress={() => setMusicRoles((previous) => previous.includes(role) ? previous.filter((value) => value !== role) : [...previous,role])} />)}</View>
      {!availableRoles.length ? <Text style={ui.text}>Los personajes aparecerán al añadir los fragmentos.</Text> : null}<Button label="Listo" onPress={() => setRolesOpen(false)} />
    </Sheet>
    {editor && manifest ? <MusicalAuditionEditor key={editor.key} manifest={manifest} initial={editor.initial} onUpdated={onUpdated} onClose={() => setEditor(null)} onSaved={() => { setMine(false); setQuery(''); setNotice('Audición guardada.'); }} /> : null}
  </>;
};
