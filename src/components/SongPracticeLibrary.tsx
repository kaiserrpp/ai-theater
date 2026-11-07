import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SharedScriptManifest, SharedSongAudioAsset } from '../types/sharedScript';
import { Button, Chip, Icon, palette, ui } from './PracticeUI';

type Track = { key: string; title: string; lyrics: string; audio: SharedSongAudioAsset };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export const SongPracticeLibrary = ({ manifest, active }: { manifest: SharedScriptManifest | null; active: boolean }) => {
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
  const visibleTracks = tracks.filter((track) => kind === 'all' || track.audio.kind === kind);

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

  return <ScrollView contentContainerStyle={ui.page}>
    <View style={{ gap: 8 }}><Text style={ui.title}>Escuchar y practicar</Text><Text style={ui.text}>Tus canciones, con voz o karaoke.</Text></View>
    <View style={ui.wrap}>{([['all', 'Todas'], ['vocal_guide', 'Con voz'], ['karaoke', 'Karaoke']] as const).map(([value, label]) => <Chip key={value} label={label} selected={kind === value} onPress={() => setKind(value)} />)}</View>
    {selected ? <View style={[ui.card, { backgroundColor: palette.soft, borderColor: palette.soft }]}>
      <Text style={ui.label}>REPRODUCTOR</Text><Text style={ui.subtitle}>{selected.title}</Text><Text style={ui.text}>{selected.audio.label}</Text>
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
    {!visibleTracks.length ? <View style={ui.card}><Icon name="music-note-outline" size={32} /><Text style={ui.subtitle}>No hay audios {kind === 'karaoke' ? 'de karaoke' : kind === 'vocal_guide' ? 'con voz' : 'todavía'}</Text><Text style={ui.text}>Los materiales que se añadan a esta obra aparecerán aquí.</Text></View> : null}
    {visibleTracks.map((track) => <TouchableOpacity key={track.key} accessibilityRole="button" accessibilityLabel={`Escuchar ${track.title}, ${track.audio.label}`} onPress={() => play(track)} style={[ui.card, ui.row, { padding: 16 }, selectedKey === track.key && { borderColor: palette.plum }]}>
      <Icon name={selectedKey === track.key && playing ? 'volume-high' : 'play-circle-outline'} size={30} />
      <View style={{ flex: 1, gap: 4 }}><Text style={[ui.subtitle, { fontSize: 17 }]}>{track.title}</Text><Text style={ui.text}>{track.audio.label}{track.audio.guideRoles.length ? ` · ${track.audio.guideRoles.join(', ')}` : ''}</Text></View>
    </TouchableOpacity>)}
    {selected && error ? <Button label="Reintentar audio" secondary onPress={() => play(selected)} /> : null}
  </ScrollView>;
};
