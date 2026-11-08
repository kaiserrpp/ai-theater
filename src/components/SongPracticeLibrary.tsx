import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeRoles } from '../../shared/musicalAuditions';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SharedMusicalAudition, SharedScriptManifest, SharedSongAudioAsset } from '../types/sharedScript';
import { useAdminPassword } from '../store/adminSession';
import { createSongPlayback, type SongPlaybackMode, type SongRepeatMode } from '../utils/songPlayback';
import { selectSongPlaylist, type SongPlaylistKind } from '../utils/songPlaylistSelection';
import { MusicalAuditionEditor } from './MusicalAuditionEditor';
import { Button, Chip, Icon, palette, Sheet, ui } from './PracticeUI';

type Track = { key: string; title: string; lyrics: string; audio: SharedSongAudioAsset; auditionId?: string; numberTitle?: string };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export const SongPracticeLibrary = ({ manifest, active, onUpdated, onManageWork, defaultRoles, openEditorRequest = 0 }: {
  manifest: SharedScriptManifest | null; active: boolean; defaultRoles: string[]; openEditorRequest?: number;
  onUpdated: (manifest: SharedScriptManifest) => void; onManageWork: () => void;
}) => {
  const adminPassword = useAdminPassword();
  const [scope, setScope] = useState<'auditions' | 'work'>('auditions');
  const [mine, setMine] = useState(false);
  const [musicRoles, setMusicRoles] = useState<string[]>([]);
  const [loadedRolesKey, setLoadedRolesKey] = useState<string | null>(null);
  const [rolesOpen, setRolesOpen] = useState(false);
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
      handledEditorRequest.current = openEditorRequest; setScope('auditions');
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

  useEffect(() => () => { player.current?.destroy(); player.current = null; }, []);
  useEffect(() => { player.current?.setRepeat(repeatMode); player.current?.setRate(rate); }, [repeatMode, rate]);
  useEffect(() => {
    player.current?.stop(); setSelectedKey(null); setPlaying(false); setPosition(0); setDuration(0); setError('');
  }, [manifest?.shareId]);
  useEffect(() => {
    player.current?.updateTracks(tracks);
  }, [tracks]);

  const startPlayback = (track: Track, queue: Track[], mode: SongPlaybackMode) => {
    setError('');
    if (Platform.OS !== 'web') { void Linking.openURL(track.audio.audioUrl); return; }
    if (!player.current) {
      player.current = createSongPlayback<Track>({ createAudio: () => new Audio(), onTrack: setSelectedKey, onPlaying: setPlaying,
        onPosition: setPosition, onDuration: setDuration, onQueue: setQueueInfo, onError: setError });
      player.current.setRate(rate);
    }
    const nextRepeat = repeatMode === 'off' ? 'off' : mode === 'single' ? 'track' : 'queue';
    setPlaybackMode(mode); setRepeatMode(nextRepeat); player.current.setRepeat(nextRepeat);
    player.current.play(track, queue, mode);
  };
  const play = (track: Track) => {
    const queue = track.auditionId ? playlist(track.audio.kind, 'auditions') : visibleTracks;
    startPlayback(track, queue, 'single');
  };
  const playGroup = (value: SongPlaylistKind) => {
    const queue = playlist(value);
    if (!queue.length) return;
    setKind(value); startPlayback(queue[0], queue, 'queue');
    scroll.current?.scrollTo({ y: 0, animated: true });
  };
  const toggle = () => { if (playing) player.current?.pause(); else player.current?.resume(); };

  if (!active) return selected ? <View style={[ui.header, { backgroundColor: palette.soft, gap: 6, paddingHorizontal: 16 }]}>
    <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: palette.ink, fontWeight: '600' }}>{selected.title}</Text><Text numberOfLines={1} style={ui.text}>{selected.audio.label}</Text></View>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Canción anterior" disabled={queueInfo.total < 2} onPress={() => player.current?.navigate('previous')} style={[ui.icon, { width: 36 }, queueInfo.total < 2 && { opacity: 0.4 }]}><Icon name="skip-previous" /></TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={playing ? 'Pausar canción' : 'Reproducir canción'} onPress={toggle} style={ui.icon}><Icon name={playing ? 'pause' : 'play'} /></TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Canción siguiente" disabled={queueInfo.total < 2} onPress={() => player.current?.navigate('next')} style={[ui.icon, { width: 36 }, queueInfo.total < 2 && { opacity: 0.4 }]}><Icon name="skip-next" /></TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cerrar reproductor" onPress={() => player.current?.stop()} style={[ui.icon, { width: 36 }]}><Icon name="close" /></TouchableOpacity>
  </View> : null;

  return <>
    <ScrollView ref={scroll} contentContainerStyle={ui.page}>
    <View style={{ gap: 8 }}><Text style={ui.title}>Escuchar y practicar</Text><Text style={ui.text}>Tus canciones, con voz o karaoke.</Text></View>
    <View style={ui.wrap}><Chip label="Audiciones" selected={scope === 'auditions'} onPress={() => setScope('auditions')} /><Chip label="Obra" selected={scope === 'work'} onPress={() => setScope('work')} /></View>
    {scope === 'auditions' ? <>
      <Button label="+ Subir canción de audición" disabled={!manifest} onPress={() => openEditor()} />
      {notice ? <Text accessibilityLiveRegion="polite" style={[ui.text, { color: palette.green }]}>{notice}</Text> : null}
      <View style={ui.wrap}><Chip label="Todas" selected={!mine} onPress={() => setMine(false)} /><Chip label="Mis personajes" selected={mine} onPress={() => { setMine(true); if (!musicRoles.length) setRolesOpen(true); }} /><TouchableOpacity accessibilityRole="button" accessibilityLabel="Elegir personajes" onPress={() => setRolesOpen(true)} style={ui.icon}><Icon name="account-cog-outline" /></TouchableOpacity></View>
      {mine && musicRoles.length ? <Text style={ui.text}>{musicRoles.join(' · ')}</Text> : null}
      {(manifest?.musicalAuditions?.length || 0) > 4 ? <TextInput accessibilityLabel="Buscar audición musical" placeholder="Buscar canción, fragmento o personaje" value={query} onChangeText={setQuery} style={{ padding: 12, fontSize: 16, borderRadius: 12, borderWidth: 1, borderColor: palette.rule, color: palette.ink }} /> : null}
    </> : null}
    <View testID="song-playlist-actions" style={{ gap: 10 }}><Text style={ui.label}>REPRODUCIR GRUPO</Text><View style={ui.wrap}>
      {([['all', 'Todas', 'Reproducir todas las canciones'], ['vocal_guide', 'Vocal guide', 'Reproducir vocal guides'], ['karaoke', 'Karaoke', 'Reproducir karaokes']] as const).map(([value, label, accessibilityLabel]) => <Chip key={value} label={`▶ ${label}`} accessibilityLabel={accessibilityLabel} selected={Boolean(selected) && kind === value && playbackMode === 'queue' && (selected?.auditionId ? 'auditions' : 'work') === scope} disabled={!playlist(value).length} onPress={() => playGroup(value)} />)}
    </View><Text style={ui.text}>O toca una canción para escucharla sola.</Text></View>

    {selected ? <View style={[ui.card, { backgroundColor: palette.soft, borderColor: palette.soft }]}>
      <View style={ui.row}><Text style={[ui.label, { flex: 1 }]}>REPRODUCTOR</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Cerrar reproductor" onPress={() => player.current?.stop()} style={ui.icon}><Icon name="close" size={20} /></TouchableOpacity></View><Text style={ui.subtitle}>{selected.title}</Text><Text style={ui.text}>{selected.numberTitle ? `${selected.numberTitle} · ` : ''}{selected.audio.label}</Text>
      <Text testID="song-queue-status" accessibilityLiveRegion="polite" style={ui.text}>{queueInfo.index + 1} de {queueInfo.total} · {playbackMode === 'single' ? 'Solo esta canción' : repeatMode === 'queue' ? 'Cola en bucle' : repeatMode === 'track' ? 'Una canción en bucle' : 'La cola termina al llegar al final'}</Text>
      {selected.auditionId ? <View style={ui.row}>{([['vocal_guide','Con voz'],['karaoke','Karaoke']] as const).map(([audioKind,label]) => {
        const track = tracks.find((candidate) => candidate.auditionId === selected.auditionId && candidate.audio.kind === audioKind);
        return <View key={audioKind} style={{flex:1}}><Button label={label} secondary={selected.audio.kind !== audioKind} disabled={!track} onPress={() => { if (track) play(track); }} /></View>;
      })}</View> : null}
      <View style={[ui.row, { justifyContent: 'space-between', gap: 0 }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Canción anterior" disabled={queueInfo.total < 2} onPress={() => player.current?.navigate('previous')} style={[ui.icon, { width: 44 }, queueInfo.total < 2 && { opacity: 0.4 }]}><Icon name="skip-previous" size={30} /></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retroceder diez segundos" style={[ui.icon, { width: 44 }]} onPress={() => player.current?.seek(position - 10)}><Icon name="rewind-10" size={26} /></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={playing ? 'Pausar canción' : 'Reproducir canción'} onPress={toggle} style={[ui.icon, { width: 60, height: 60, backgroundColor: palette.plum }]}><Icon name={playing ? 'pause' : 'play'} color="#fff" size={32} /></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Avanzar diez segundos" style={[ui.icon, { width: 44 }]} onPress={() => player.current?.seek(position + 10)}><Icon name="fast-forward-10" size={26} /></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Canción siguiente" disabled={queueInfo.total < 2} onPress={() => player.current?.navigate('next')} style={[ui.icon, { width: 44 }, queueInfo.total < 2 && { opacity: 0.4 }]}><Icon name="skip-next" size={30} /></TouchableOpacity>
      </View>
      {Platform.OS === 'web' ? <input aria-label="Posición de la canción" type="range" min={0} max={duration || 1} step={0.1} value={position} style={{ width: '100%', accentColor: palette.plum, minHeight: 30 }} onChange={(event) => player.current?.seek(Number(event.target.value))} /> : null}
      <View style={[ui.row, { justifyContent: 'space-between' }]}><Text style={ui.text}>{clock(position)}</Text><Text style={ui.text}>{clock(duration)}</Text></View>
      <View testID="song-speed-control" style={{ gap: 4 }}>
        <View style={[ui.row, { justifyContent: 'space-between' }]}><Text style={ui.text}>Velocidad · {rate.toFixed(2).replace('.', ',')}×</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Restablecer velocidad normal" onPress={() => setRate(1)} style={[ui.icon, { width: 44 }]}><Text style={{ color: palette.plum, fontWeight: '700' }}>1×</Text></TouchableOpacity></View>
        {Platform.OS === 'web' ? <input aria-label="Velocidad de reproducción" aria-valuetext={`${rate.toFixed(2).replace('.', ',')} veces la velocidad normal`} type="range" min={0.7} max={1} step={0.05} value={rate} style={{ width: '100%', accentColor: palette.plum, minHeight: 30 }} onChange={(event) => setRate(Number(event.target.value))} /> : null}
        <View style={[ui.row, { justifyContent: 'space-between' }]}><Text style={[ui.text, { fontSize: 12 }]}>0,70× · Más despacio</Text><Text style={[ui.text, { fontSize: 12 }]}>1× · Normal</Text></View>
      </View>
      <View style={ui.wrap}>{playbackMode === 'queue' ? <Chip label="Repetir cola" selected={repeatMode === 'queue'} onPress={() => setRepeatMode(repeatMode === 'queue' ? 'off' : 'queue')} /> : null}<Chip label="Repetir canción" selected={repeatMode === 'track'} onPress={() => setRepeatMode(repeatMode === 'track' ? playbackMode === 'queue' ? 'queue' : 'off' : 'track')} />{selected.lyrics ? <Chip label={lyricsOpen ? 'Ocultar letra' : 'Ver letra'} selected={lyricsOpen} onPress={() => setLyricsOpen(!lyricsOpen)} /> : null}</View>
      {lyricsOpen && selected.lyrics ? <Text selectable style={[ui.text, { color: palette.ink }]}>{selected.lyrics}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={ui.error}>{error}</Text> : null}
    </View> : null}
    {scope === 'auditions' ? <>
      {!visibleCuts.length ? <View style={ui.card}><Icon name="music-note-outline" size={32} /><Text style={ui.subtitle}>{mine ? 'No hay fragmentos para estos personajes' : 'Canciones para tus audiciones'}</Text><Text style={ui.text}>{mine ? 'Puedes cambiar tus personajes o ver todas las audiciones.' : 'Añade un fragmento, sus personajes y los audios con voz y karaoke. Aparecerán aquí para practicar.'}</Text></View> : null}
      {visibleCuts.map((cut) => <View key={cut.id} style={ui.card}>
        <View style={ui.row}><View style={{ flex: 1, gap: 6 }}><Text style={ui.label}>{manifest?.musicalNumbers.find((number) => number.id === cut.musicalNumberId)?.title || 'Número musical'}</Text><Text style={ui.subtitle}>{cut.title}</Text><Text style={ui.text}>{cut.roles.join(' · ')}</Text></View>
          {adminPassword ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Editar ${cut.title}`} onPress={() => openEditor(cut)} style={ui.icon}><Icon name="pencil-outline" /></TouchableOpacity> : null}
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
    <Button label="Gestionar audios de la obra" secondary disabled={!manifest} onPress={onManageWork} />
    </>}
    {selected && error ? <Button label="Reintentar audio" secondary onPress={() => play(selected)} /> : null}
    </ScrollView>
    <Sheet title="Mis personajes · Canciones" visible={rolesOpen} onClose={() => setRolesOpen(false)}>
      <Text style={ui.text}>Esta selección se recuerda para las canciones de esta obra en este dispositivo.</Text><View style={ui.wrap}>{availableRoles.map((role) => <Chip key={role} label={role} selected={musicRoles.includes(role)} onPress={() => setMusicRoles((previous) => previous.includes(role) ? previous.filter((value) => value !== role) : [...previous,role])} />)}</View>
      {!availableRoles.length ? <Text style={ui.text}>Los personajes aparecerán al añadir los fragmentos.</Text> : null}<Button label="Listo" onPress={() => setRolesOpen(false)} />
    </Sheet>
    {editor && manifest ? <MusicalAuditionEditor key={editor.key} manifest={manifest} initial={editor.initial} onUpdated={onUpdated} onClose={() => setEditor(null)} onSaved={() => { setMine(false); setQuery(''); setNotice('Audición guardada.'); }} /> : null}
  </>;
};
