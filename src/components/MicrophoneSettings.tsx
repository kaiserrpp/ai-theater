import React from 'react';
import { Switch, Text, TouchableOpacity, View } from 'react-native';
import { ListenPreference } from '../utils/rehearsalPreferences';
import { Icon, palette, ui } from './PracticeUI';

export const MicrophoneSettings = ({ mode, onModeChange, showTranscript, onTranscriptChange, supported }: {
  mode: ListenPreference; onModeChange: (mode: ListenPreference) => void;
  showTranscript: boolean; onTranscriptChange: (visible: boolean) => void; supported: boolean;
}) => <>
  <Text style={ui.text}>La app recuerda tu elección en este dispositivo. Al iniciar un ensayo comprobaremos la escucha.</Text>
  {([
    ['intelligent', 'Inteligente', 'Comprueba tus palabras y avanza al completar la réplica.'],
    ['manual', 'Manual', 'Avanza tú con el botón siguiente.'],
    ['auto', 'Al terminar de hablar', 'Avanza al detectar silencio. Requiere calibrar el micro.'],
  ] as const).map(([value, label, hint]) => <TouchableOpacity key={value} accessibilityRole="radio"
    aria-checked={mode === value}
    accessibilityState={{ checked: mode === value, disabled: value === 'intelligent' && !supported }}
    disabled={value === 'intelligent' && !supported} onPress={() => onModeChange(value)}
    style={[ui.card, ui.row, { padding: 16, opacity: value === 'intelligent' && !supported ? 0.45 : 1 }, mode === value && { borderColor: palette.plum, backgroundColor: palette.soft }]}>
    <Icon name={mode === value ? 'radiobox-marked' : 'radiobox-blank'} />
    <View style={{ flex: 1, gap: 4 }}><Text style={[ui.subtitle, { fontSize: 16 }]}>{label}</Text><Text style={ui.text}>{hint}</Text></View>
  </TouchableOpacity>)}
  {!supported ? <Text style={ui.text}>Este navegador no ofrece reconocimiento de voz. Puedes ensayar en modo manual.</Text> : null}
  <View style={[ui.card, ui.row]}><View style={{ flex: 1, gap: 4 }}><Text style={[ui.subtitle, { fontSize: 16 }]}>Mostrar transcripción</Text>
    <Text style={ui.text}>Muestra lo que la app oye en modo inteligente.</Text></View>
    <Switch accessibilityLabel="Mostrar transcripción" value={showTranscript} onValueChange={onTranscriptChange} trackColor={{ true: palette.plum }} />
  </View>
</>;
