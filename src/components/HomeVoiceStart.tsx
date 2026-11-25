import React, { useEffect, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useVoiceCommand } from '../hooks/useVoiceCommand';
import { isHomeRehearsalCommand } from '../utils/voiceAdvance';
import { isPageVisible } from '../utils/pageVisibility';
import { Button, Icon, usePracticeTheme } from './PracticeUI';

export const HomeVoiceStart = ({ armed, onArmedChange, onStart }: { armed: boolean; onArmedChange: (armed: boolean) => void; onStart: () => void }) => {
  const { ui, palette } = usePracticeTheme();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const requested = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const begin = useRef(() => {});
  const voice = useVoiceCommand('home:ensayo', armed && !starting, () => begin.current(), isHomeRehearsalCommand);
  begin.current = () => {
    if (requested.current) return;
    requested.current = true; setStarting(true); voice.releaseVoiceInput();
    void voice.waitForRecognitionEnd().then(ended => {
      if (!alive.current) return;
      if (ended && isPageVisible()) onStart();
      else { requested.current = false; setStarting(false); onArmedChange(false); setError('La escucha se ha interrumpido. Vuelve a activarla para empezar.'); }
    });
  };
  const activate = () => {
    requested.current = false;
    setError('');
    onArmedChange(true);
    voice.restartRecognition();
  };
  return <View testID="home-voice-start" style={{ gap: 8 }}>
    <View style={ui.row}><Icon name={armed ? 'microphone-outline' : 'microphone-off'} size={22} />
    <Text style={[ui.text, { flex: 1 }]}>{starting ? 'Preparando tu ensayo…' : !armed ? 'Inicio por voz' : voice.isAudioActive ? 'Di «ensayo» para empezar' : 'Preparando la escucha…'}</Text>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={armed ? 'Desactivar inicio por voz' : 'Activar inicio por voz'} disabled={!voice.isSupported || starting} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }} onPress={() => {
      if (armed) { voice.releaseVoiceInput(); onArmedChange(false); }
      else activate();
    }}><Text style={[ui.text, { color: palette.plum, fontWeight: '600' }]}>{armed ? 'Desactivar' : 'Activar'}</Text></TouchableOpacity></View>
    {voice.error || error ? <><Text style={ui.error}>{error || voice.error}</Text><Button label="Reintentar inicio por voz" secondary onPress={activate} /></> : null}
  </View>;
};
