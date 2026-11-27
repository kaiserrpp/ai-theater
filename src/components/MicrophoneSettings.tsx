import React, { useState, useSyncExternalStore } from 'react';
import { Platform, Switch, Text, TouchableOpacity, View } from 'react-native';
import type { RehearsalListenPreference } from '../utils/rehearsalPreferences';
import { rehearsalPreparationSession } from '../utils/rehearsalPreparationSession';
import { Button, Disclosure, Icon, usePracticeTheme } from './PracticeUI';
import type { RecognitionEngine } from '../utils/scriptRecognitionContext';
import { getNativePrototypeInfo } from '../utils/nativePrototype';
import { getSpeechOutputHelp } from '../utils/speechOutputHelp';

export const MicrophoneSettings = ({ mode, onModeChange, showTranscript, onTranscriptChange, supported, canUseOpenAi, onRepeatPreparation, engine = 'native', onEngineChange }: {
  mode: RehearsalListenPreference; onModeChange: (mode: RehearsalListenPreference) => void;
  showTranscript: boolean; onTranscriptChange: (visible: boolean) => void; supported: boolean;
  canUseOpenAi: boolean;
  onRepeatPreparation?: () => void;
  engine?: RecognitionEngine; onEngineChange?: (engine: RecognitionEngine) => void;
}) => {
  const { palette, ui } = usePracticeTheme();
  const preparation = useSyncExternalStore(rehearsalPreparationSession.subscribe, rehearsalPreparationSession.getSnapshot, rehearsalPreparationSession.getSnapshot);
  const [repeatRequested, setRepeatRequested] = useState(false);
  const native = getNativePrototypeInfo();
  return <>
  <Text style={ui.text}>Los ajustes se guardan en este dispositivo.</Text>
  {([
    ['intelligent', 'Inteligente', 'Comprueba tus palabras y avanza al completar la réplica.'],
    ['openai', 'OpenAI', 'Transcribe tu voz con OpenAI en tus turnos. Requiere conexión.'],
    ['manual', 'Manual', 'Avanza tú con el botón siguiente.'],
    ['auto', 'Al terminar de hablar', 'Avanza al detectar silencio, sin comparar el texto. Requiere calibrar el micro.'],
  ] as const).filter(([value]) => value !== 'openai' || canUseOpenAi).map(([value, label, hint]) => <TouchableOpacity key={value} accessibilityRole="radio"
    accessibilityLabel={label} accessibilityHint={hint}
    aria-checked={mode === value}
    accessibilityState={{ checked: mode === value, disabled: value === 'intelligent' && !supported }}
    disabled={value === 'intelligent' && !supported} onPress={() => onModeChange(value)}
    style={[ui.card, ui.row, { padding: 16, opacity: value === 'intelligent' && !supported ? 0.45 : 1 }, mode === value && { borderColor: palette.plum, backgroundColor: palette.soft }]}>
    <Icon name={mode === value ? 'radiobox-marked' : 'radiobox-blank'} />
    <View style={{ flex: 1, gap: 4 }}><Text style={[ui.subtitle, { fontSize: 16 }]}>{label}</Text><Text style={ui.text}>{hint}</Text></View>
  </TouchableOpacity>)}
  {!supported ? <Text style={ui.text}>Este navegador no ofrece reconocimiento de voz. Puedes ensayar en modo manual.</Text> : null}
  {onEngineChange && mode !== 'openai' ? <View style={ui.card}>
    <Disclosure title="Motor de reconocimiento" summary={engine === 'native' ? native ? 'Nativo del teléfono' : 'Safari / navegador' : engine === 'vosk' ? 'Vosk' : engine === 'whisper' ? 'Whisper' : 'Comparativa'}>
    <Text style={ui.text}>{native ? 'El prototipo usa el reconocimiento integrado del teléfono. Inteligente conserva las pausas y decide el avance por tus palabras. Vosk, Whisper y la comparativa siguen disponibles para las pruebas.' : 'Safari es la opción por defecto en iPhone; en otros dispositivos se usa el reconocimiento del navegador. Puedes elegir Vosk o Whisper y seguir comparando los tres. En Inteligente, las pausas se conservan.'}</Text>
    {([['native', native ? `${native.platform === 'ios' ? 'Apple · iPhone' : 'Android'} · reconocimiento nativo` : 'Safari / navegador · por defecto'], ['vosk', 'Vosk · local en español'], ['whisper', 'Whisper con contexto del guion'], ['comparison', 'Comparativa durante el ensayo · tres motores']] as const).map(([value, label]) =>
      <TouchableOpacity key={value} accessibilityRole="radio" aria-checked={engine === value} accessibilityState={{ checked: engine === value }}
        onPress={() => { if (value === 'comparison') onModeChange('intelligent'); onEngineChange(value); }} style={[ui.row, { paddingVertical: 12 }]}>
        <Icon name={engine === value ? 'radiobox-marked' : 'radiobox-blank'} /><Text style={ui.text}>{label}</Text>
      </TouchableOpacity>)}
    </Disclosure>
    {engine === 'comparison' ? <Text style={ui.text}>En Comparativa, dos segundos sin voz cierran la toma y se avanza aunque la coincidencia sea 0 %. El informe guarda los tres resultados.</Text> : null}
  </View> : null}
  <View style={[ui.card, ui.row]}><View style={{ flex: 1, gap: 4 }}><Text style={[ui.subtitle, { fontSize: 16 }]}>Mostrar transcripción</Text>
    <Text style={ui.text}>Muestra lo que la app oye durante tu réplica.</Text></View>
    <Switch accessibilityLabel="Mostrar transcripción" value={showTranscript} onValueChange={onTranscriptChange} trackColor={{ true: palette.plum }} />
  </View>
  <View style={ui.card}>
    <View style={ui.row}><View style={{ flex: 1, gap: 4 }}><Text style={ui.subtitle}>Recordar audio y micrófono</Text>
      <Text style={ui.text}>Conserva las pruebas al cerrar la app.</Text></View>
      <Switch accessibilityLabel="Recordar configuración de audio y micrófono" value={preparation.remember} disabled={!preparation.loaded}
        onValueChange={value => rehearsalPreparationSession.setRemember(value)} trackColor={{ true: palette.plum }} /></View>
  </View>
  <View style={ui.card}>
    <Text style={ui.subtitle}>Pruebas de audio</Text>
    <Text accessibilityLiveRegion="polite" style={ui.text}>{repeatRequested
      ? 'Volveremos a comprobar el audio al empezar el próximo ensayo.'
      : !preparation.loaded ? 'Recuperando tu configuración de audio…'
      : preparation.speakerConfirmed ? preparation.remember ? 'Usaremos por defecto las pruebas de audio guardadas en este dispositivo.' : 'Reutilizaremos las pruebas mientras la app siga abierta.'
      : 'Comprobaremos el audio al empezar el ensayo.'}</Text>
    {preparation.storageError ? <Text accessibilityLiveRegion="polite" style={ui.error}>{preparation.storageError}</Text> : null}
    <Button label={onRepeatPreparation ? 'Repetir pruebas de audio' : 'Repetir pruebas en el próximo ensayo'} secondary onPress={() => {
      rehearsalPreparationSession.reset();
      setRepeatRequested(true);
      onRepeatPreparation?.();
    }} />
    <Disclosure title="Ayuda y prueba avanzada">
    <Text style={ui.text}>Si cambias de micrófono, altavoz o entorno, puedes repetir las pruebas.</Text>
    <Text style={ui.text}>{getSpeechOutputHelp()}</Text>
    {Platform.OS === 'web' ? <Button label="Comprobar voz, pitido y micrófono" secondary onPress={() => {
      if (typeof window !== 'undefined') window.location.assign('/prueba-audio.html');
    }} /> : null}
    </Disclosure>
  </View>
</>;
};
