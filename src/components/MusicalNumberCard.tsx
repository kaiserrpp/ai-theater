import React, { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { CHOIR_PART_LABELS, type ChoirPart } from '../../shared/choirParts';
import type { Dialogue } from '../types/script';
import type { SharedMusicalNumberAsset, SharedSongAudioAsset } from '../types/sharedScript';
import {
  getNumberBlocks,
  getNumberCharacters,
  getNumberKaraoke,
  getNumberRoles,
  getNumberTimingIssue,
  getNumberVocalGuides,
  getReferenceAudio,
  isNumberInstrumental,
  type NumberAudioMode,
  type NumberRehearsalRequest,
} from '../utils/musicalNumberPractice';
import { selectChoirTrack } from '../utils/songPlaylistSelection';
import { Button, Chip, Disclosure, Icon, usePracticeTheme } from './PracticeUI';

const labelForMode: Record<NumberAudioMode, string> = {
  reference: 'Escuchar con letra',
  vocal_guide: 'Guía vocal',
  harmony: 'Armonía',
  karaoke: 'Karaoke',
};

type Props = {
  number: SharedMusicalNumberAsset;
  audios: SharedSongAudioAsset[];
  lyrics: string;
  guion: Dialogue[];
  workRoles: string[];
  choirPart: ChoirPart | null;
  rememberedKaraoke: (character: string) => string | undefined;
  onRememberKaraoke: (character: string, audioId: string) => void;
  karaokeLoaded: boolean;
  expanded: boolean;
  onToggle: () => void;
  onPlay: (audio: SharedSongAudioAsset, mode: NumberAudioMode) => void;
  onRehearse?: (request: NumberRehearsalRequest) => void;
};

export const MusicalNumberCard = ({
  number, audios, lyrics, guion, workRoles, choirPart, rememberedKaraoke,
  onRememberKaraoke, karaokeLoaded, expanded, onToggle, onPlay, onRehearse,
}: Props) => {
  const { ui, palette } = usePracticeTheme();
  const cast = getNumberRoles(number, audios);
  const characters = getNumberCharacters(cast, workRoles);
  const [characterOverride, setCharacterOverride] = useState<string | null>(null);
  const character = characters.find((role) => role === characterOverride) ?? characters[0] ?? null;
  const [mode, setMode] = useState<NumberAudioMode>('reference');
  const [preview, setPreview] = useState<{
    mode: NumberAudioMode; character: string | null; audioId: string; completeKaraokeId?: string;
  } | null>(null);
  useEffect(() => {
    if (!expanded) { setCharacterOverride(null); setMode('reference'); setPreview(null); }
  }, [expanded]);
  const reference = getReferenceAudio(number, audios);
  const vocalGuides = getNumberVocalGuides(audios, character);
  const harmony = audios.filter((audio) => audio.choirPart);
  const preferredHarmony = selectChoirTrack(harmony.map((audio) => ({ key: audio.id, audio })), choirPart)?.audio;
  const karaoke = getNumberKaraoke(audios, cast, character, character ? rememberedKaraoke(character) : undefined);
  const modes: NumberAudioMode[] = ['reference', ...(character ? ['vocal_guide', 'karaoke'] as const : []),
    ...(harmony.length ? ['harmony'] as const : [])];
  const currentMode = modes.includes(mode) ? mode : 'reference';
  const options = currentMode === 'vocal_guide' ? vocalGuides : currentMode === 'harmony' ? harmony
    : currentMode === 'karaoke' ? karaoke.options : audios;
  const preferred = currentMode === 'vocal_guide' ? vocalGuides[0] : currentMode === 'harmony' ? preferredHarmony
    : currentMode === 'karaoke' ? karaoke.preferred : reference;
  const previewId = preview?.mode === currentMode && preview.character === character &&
    (currentMode !== 'karaoke' || preview.completeKaraokeId === karaoke.complete[0]?.id) ? preview.audioId : null;
  const selected = options.find((audio) => audio.id === previewId) ?? preferred;
  const blocks = expanded ? getNumberBlocks(number, guion) : [];
  const issue = selected && getNumberTimingIssue(blocks, selected);
  const loaded = currentMode !== 'karaoke' || karaokeLoaded;

  const choose = (audio: SharedSongAudioAsset) => {
    setPreview({ mode: currentMode, character, audioId: audio.id, completeKaraokeId: karaoke.complete[0]?.id });
    if (currentMode === 'karaoke' && character) onRememberKaraoke(character, audio.id);
  };

  return <View style={ui.card} testID="musical-number-card">
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Abrir número ${number.title}`}
      accessibilityState={{ expanded }} onPress={onToggle} style={ui.row}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={ui.subtitle}>{number.title}</Text>
        {cast.length ? <Text numberOfLines={2} style={ui.text}>{cast.join(' · ')}</Text> : null}
        {preferredHarmony?.choirPart ? <Text style={ui.text}>Armonía · {CHOIR_PART_LABELS[preferredHarmony.choirPart]}</Text> : null}
      </View>
      <Icon name={expanded ? 'chevron-up' : 'chevron-down'} />
    </TouchableOpacity>
    {expanded ? <>
      {characters.length > 1 ? <View style={{ gap: 6 }}>
        <Text style={ui.text}>Personaje para este ensayo</Text>
        <View style={ui.wrap}>{characters.map((role) => <Chip key={role} label={role} selected={role === character}
          onPress={() => { setCharacterOverride(role); setPreview(null); }} />)}</View>
      </View> : character ? <Text style={ui.text}>Tu personaje · {character}</Text> : null}
      <View style={ui.wrap}>{modes.map((item) => <Chip key={item} label={labelForMode[item]} selected={item === currentMode}
        onPress={() => { setMode(item); setPreview(null); }} />)}</View>
      {selected ? <View style={{ gap: 8 }}>
        <Text style={ui.text}>{selected.label}</Text>
        <Button label="Reproducir" accessibilityLabel={`Escuchar ${number.title}, ${selected.label}`} disabled={!loaded}
          onPress={() => onPlay(selected, currentMode)} />
        {onRehearse && !issue ? <Button label="Ensayar con diálogos" secondary disabled={!loaded}
          onPress={() => onRehearse({ numberId: number.id, audioId: selected.id, character, mode: currentMode })} /> : null}
        {onRehearse && blocks.length && issue ? <Text style={ui.text}>{issue}</Text> : null}
      </View> : null}
      {options.length ? <Disclosure title={currentMode === 'karaoke' ? 'Pistas de karaoke' : 'Versiones'}
        key={currentMode} initiallyOpen={!selected}>
        <View style={ui.wrap}>{options.map((audio) => <Chip key={audio.id}
          label={audio.label} selected={audio.id === selected?.id} disabled={!loaded} onPress={() => choose(audio)} />)}</View>
      </Disclosure> : <Text style={ui.text}>{currentMode === 'vocal_guide' ? 'Guía del personaje pendiente.'
        : currentMode === 'karaoke' ? 'Karaoke del personaje pendiente.' : 'Pistas pendientes.'}</Text>}
      {currentMode === 'karaoke' && !audios.some(isNumberInstrumental) ? <Text style={ui.text}>Instrumental pendiente.</Text> : null}
      <Disclosure title="Letra"><Text selectable style={[ui.text, { color: palette.ink }]}>{lyrics || 'Letra pendiente.'}</Text></Disclosure>
      <Disclosure title="Tramo de escena" summary={blocks.length ? number.sceneTitle ?? undefined : 'Vínculo al guion pendiente'}>
        {blocks.length ? blocks.map((block) => <View key={block.startLineIndex} style={{ gap: 3 }}>
          <Text style={ui.label}>{block.kind === 'song' ? 'Canto' : 'Diálogo'}</Text>
          {guion.slice(block.startLineIndex, block.endLineIndex + 1).map((line, index) => <Text selectable
            key={block.startLineIndex + index} style={ui.text}>{block.kind === 'song' ? line.songTitle || line.t : `${line.p} · ${line.t}`}</Text>)}
        </View>) : <Text style={ui.text}>Vincula un tramo desde la gestión del número.</Text>}
      </Disclosure>
    </> : null}
  </View>;
};
