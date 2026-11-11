import React, { useState, useSyncExternalStore } from 'react';
import { Platform, Switch, Text, TouchableOpacity, View } from 'react-native';
import { ListenPreference } from '../utils/rehearsalPreferences';
import { rehearsalPreparationSession } from '../utils/rehearsalPreparationSession';
import { Button, Icon, usePracticeTheme } from './PracticeUI';

export const MicrophoneSettings = ({ mode, onModeChange, showTranscript, onTranscriptChange, supported, onRepeatPreparation }: {
  mode: ListenPreference; onModeChange: (mode: ListenPreference) => void;
  showTranscript: boolean; onTranscriptChange: (visible: boolean) => void; supported: boolean;
  onRepeatPreparation?: () => void;
}) => {
  const { palette, ui } = usePracticeTheme();
  const preparation = useSyncExternalStore(rehearsalPreparationSession.subscribe, rehearsalPreparationSession.getSnapshot, rehearsalPreparationSession.getSnapshot);
  const [repeatRequested, setRepeatRequested] = useState(false);
  return <>
  <Text style={ui.text}>La app recuerda tu elección en este dispositivo. Las pruebas de audio se hacen una vez y se conservan hasta que cierres la app.</Text>
  {([
    ['intelligent', 'Inteligente', 'Comprueba tus palabras y avanza al completar la réplica.'],
    ['manual', 'Manual', 'Avanza tú con el botón siguiente.'],
    ['auto', 'Al terminar de hablar', 'Avanza al detectar silencio, sin comparar el texto. Requiere calibrar el micro.'],
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
  <View style={ui.card}>
    <Text style={ui.subtitle}>Pruebas de audio</Text>
    <Text accessibilityLiveRegion="polite" style={ui.text}>{repeatRequested
      ? 'Volveremos a comprobar el audio al empezar el próximo ensayo.'
      : preparation.speakerConfirmed ? 'El altavoz ya está comprobado. Reutilizaremos las pruebas completadas mientras la app siga abierta.'
      : 'Comprobaremos el audio al empezar el ensayo.'}</Text>
    <Button label={onRepeatPreparation ? 'Repetir pruebas de audio' : 'Repetir pruebas en el próximo ensayo'} secondary onPress={() => {
      rehearsalPreparationSession.reset();
      setRepeatRequested(true);
      onRepeatPreparation?.();
    }} />
    {Platform.OS === 'web' ? <Button label="Comprobar voz, pitido y micrófono" secondary onPress={() => {
      if (typeof window !== 'undefined') window.location.assign('/prueba-audio.html');
    }} /> : null}
  </View>
</>;
};
