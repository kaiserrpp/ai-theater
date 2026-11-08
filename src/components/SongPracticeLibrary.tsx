import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeRoles } from '../../shared/musicalAuditions';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SharedMusicalAudition, SharedScriptManifest, SharedSongAudioAsset } from '../types/sharedScript';
import { useAdminPassword } from '../store/adminSession';
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
  const [kind, setKind] = useState<'all' | 'vocal_guide' | 'karaoke'>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loop, setLoop] = useState(false);
  const [rate, setRate] = useState(1);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [error, setError] = useState('');
  const player = useRef<HTMLAudioElement | null>(null);
  const selected = tracks.find((track) => track.key === selectedKey) ?? null;
  const visibleTracks = tracks.filter((track) => !track.auditionId && (kind === 'all' || track.audio.kind === kind));

  useEffect(() => () => { player.current?.pause(); player.current = null; }, []);
  useEffect(() => { if (player.current) { player.current.loop = loop; player.current.playbackRate = rate; } }, [loop, rate]);
  useEffect(() => {
    player.current?.pause(); setSelectedKey(null); setPlaying(false); setPosition(0); setDuration(0); setError('');
  }, [manifest?.shareId]);
  useEffect(() => {
    if (selectedKey && !tracks.some((track) => track.key === selectedKey)) {
      player.current?.pause(); player.current = null; setSelectedKey(null); setPlaying(false);
    }
  }, [selectedKey, tracks]);

  const play = (track: Track) => {
    setError('');
    if (Platform.OS !== 'web') { void Linking.openURL(track.audio.audioUrl); return; }
    let audio = player.current;
    if (selectedKey !== track.key || !audio || audio.src !== track.audio.audioUrl) {
      audio?.pause();
      audio = new Audio(track.audio.audioUrl);
      player.current = audio;
      setSelectedKey(track.key); setPosition(0); setDuration(0);
      audio.ontimeupdate = () => { if (player.current === audio) setPosition(audio?.currentTime ?? 0); };
      audio.onloadedmetadata = audio.ondurationchange = () => { if (player.current === audio) setDuration(Number.isFinite(audio?.duration) ? audio!.duration : 0); };
      audio.onplay = () => { if (player.current === audio) setPlaying(true); };
      audio.onpause = audio.onended = () => { if (player.current === audio) setPlaying(false); };
      audio.onerror = () => { if (player.current === audio) { setPlaying(false); setError('No se pudo cargar este audio. Vuelve a intentarlo.'); } };
    }
    audio.loop = loop; audio.playbackRate = rate;
    void audio.play().catch(() => { setPlaying(false); setError('Pulsa reproducir para volver a iniciar el audio.'); });
  };
  const toggle = () => { if (playing) player.current?.pause(); else if (selected) play(selected); };

  if (!active) return selected ? <View style={[ui.header, { backgroundColor: palette.soft }]}>
    <Icon name="music-note" /><View style={{ flex: 1 }}><Text numberOfLines={1} style={{ color: palette.ink, fontWeight: '600' }}>{selected.title}</Text><Text numberOfLines={1} style={ui.text}>{selected.audio.label}</Text></View>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={playing ? 'Pausar canción' : 'Reproducir canción'} onPress={toggle} style={ui.icon}><Icon name={playing ? 'pause' : 'play'} /></TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cerrar reproductor" onPress={() => { player.current?.pause(); setSelectedKey(null); }} style={ui.icon}><Icon name="close" /></TouchableOpacity>
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
    </> : <><View style={ui.wrap}>{([['all', 'Todas'], ['vocal_guide', 'Con voz'], ['karaoke', 'Karaoke']] as const).map(([value, label]) => <Chip key={value} label={label} selected={kind === value} onPress={() => setKind(value)} />)}</View><Button label="Gestionar audios de la obra" secondary disabled={!manifest} onPress={onManageWork} /></>}

    {selected ? <View style={[ui.card, { backgroundColor: palette.soft, borderColor: palette.soft }]}>
      <View style={ui.row}><Text style={[ui.label, { flex: 1 }]}>REPRODUCTOR</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Cerrar reproductor" onPress={() => { player.current?.pause(); setSelectedKey(null); }} style={ui.icon}><Icon name="close" size={20} /></TouchableOpacity></View><Text style={ui.subtitle}>{selected.title}</Text><Text style={ui.text}>{selected.numberTitle ? `${selected.numberTitle} · ` : ''}{selected.audio.label}</Text>
      {selected.auditionId ? <View style={ui.row}>{([['vocal_guide','Con voz'],['karaoke','Karaoke']] as const).map(([audioKind,label]) => {
        const track = tracks.find((candidate) => candidate.auditionId === selected.auditionId && candidate.audio.kind === audioKind);
        return <View key={audioKind} style={{flex:1}}><Button label={label} secondary={selected.audio.kind !== audioKind} disabled={!track} onPress={() => { if (track) play(track); }} /></View>;
      })}</View> : null}
      <View style={[ui.row, { justifyContent: 'center' }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retroceder diez segundos" style={ui.icon} onPress={() => { if (player.current) player.current.currentTime = Math.max(0, player.current.currentTime - 10); }}><Icon name="rewind-10" size={30} /></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={playing ? 'Pausar canción' : 'Reproducir canción'} onPress={toggle} style={[ui.icon, { width: 64, height: 64, backgroundColor: palette.plum }]}><Icon name={playing ? 'pause' : 'play'} color="#fff" size={32} /></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Avanzar diez segundos" style={ui.icon} onPress={() => { if (player.current) player.current.currentTime = Math.min(duration, player.current.currentTime + 10); }}><Icon name="fast-forward-10" size={30} /></TouchableOpacity>
      </View>
      {Platform.OS === 'web' ? <input aria-label="Posición de la canción" type="range" min={0} max={duration || 1} step={0.1} value={position} style={{ width: '100%', accentColor: palette.plum, minHeight: 30 }} onChange={(event) => { if (player.current) { player.current.currentTime = Number(event.target.value); setPosition(Number(event.target.value)); } }} /> : null}
      <View style={[ui.row, { justifyContent: 'space-between' }]}><Text style={ui.text}>{clock(position)}</Text><Text style={ui.text}>{clock(duration)}</Text></View>
      <View style={ui.wrap}><Chip label="Repetir" selected={loop} onPress={() => setLoop(!loop)} /><Chip label={`${rate}×`} onPress={() => setRate(rate === 1 ? 0.8 : rate === 0.8 ? 1.2 : 1)} />{selected.lyrics ? <Chip label={lyricsOpen ? 'Ocultar letra' : 'Ver letra'} selected={lyricsOpen} onPress={() => setLyricsOpen(!lyricsOpen)} /> : null}</View>
      {lyricsOpen && selected.lyrics ? <Text selectable style={[ui.text, { color: palette.ink }]}>{selected.lyrics}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={ui.error}>{error}</Text> : null}
    </View> : null}
    {scope === 'auditions' ? <>
      {!visibleCuts.length ? <View style={ui.card}><Icon name="music-note-outline" size={32} /><Text style={ui.subtitle}>{mine ? 'No hay fragmentos para estos personajes' : 'Canciones para tus audiciones'}</Text><Text style={ui.text}>{mine ? 'Puedes cambiar tus personajes o ver todas las audiciones.' : 'Añade un fragmento, sus personajes y los audios con voz y karaoke. Aparecerán aquí para practicar.'}</Text></View> : null}
      {visibleCuts.map((cut) => <View key={cut.id} style={ui.card}>
        <View style={ui.row}><View style={{ flex: 1, gap: 6 }}><Text style={ui.label}>{manifest?.musicalNumbers.find((number) => number.id === cut.musicalNumberId)?.title || 'Número musical'}</Text><Text style={ui.subtitle}>{cut.title}</Text><Text style={ui.text}>{cut.roles.join(' · ')}</Text></View>
          {adminPassword ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Editar ${cut.title}`} onPress={() => openEditor(cut)} style={ui.icon}><Icon name="pencil-outline" /></TouchableOpacity> : null}
        </View>
        {selected?.auditionId !== cut.id ? <View style={ui.row}>{([['vocal_guide','Con voz'],['karaoke','Karaoke']] as const).map(([audioKind,label]) => {
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
    </ScrollView>
    <Sheet title="Mis personajes · Canciones" visible={rolesOpen} onClose={() => setRolesOpen(false)}>
      <Text style={ui.text}>Esta selección se recuerda para las canciones de esta obra en este dispositivo.</Text><View style={ui.wrap}>{availableRoles.map((role) => <Chip key={role} label={role} selected={musicRoles.includes(role)} onPress={() => setMusicRoles((previous) => previous.includes(role) ? previous.filter((value) => value !== role) : [...previous,role])} />)}</View>
      {!availableRoles.length ? <Text style={ui.text}>Los personajes aparecerán al añadir los fragmentos.</Text> : null}<Button label="Listo" onPress={() => setRolesOpen(false)} />
    </Sheet>
    {editor && manifest ? <MusicalAuditionEditor key={editor.key} manifest={manifest} initial={editor.initial} onUpdated={onUpdated} onClose={() => setEditor(null)} onSaved={() => { setMine(false); setQuery(''); setNotice('Audición guardada.'); }} /> : null}
  </>;
};
