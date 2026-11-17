import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useVoiceCommand } from '../hooks/useVoiceCommand';
import { isHomeRehearsalCommand } from '../utils/voiceAdvance';
import { isPageVisible } from '../utils/pageVisibility';
import { Button, usePracticeTheme } from './PracticeUI';

export const HomeVoiceStart = ({ initiallyEnabled, onStart }: { initiallyEnabled: boolean; onStart: () => void }) => {
  const { ui } = usePracticeTheme();
  const [armed, setArmed] = useState(initiallyEnabled);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const requested = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const begin = useRef(() => {});
  const voice = useVoiceCommand('home:ensayo', armed && !starting, () => begin.current(), isHomeRehearsalCommand);
  begin.current = () => {
    if (requested.current) return;
    requested.current = true; setStarting(true); voice.releaseVoiceInput();
    void voice.waitForRecognitionEnd().then(ended => {
      if (!alive.current) return;
      if (ended && isPageVisible()) onStart();
      else { requested.current = false; setStarting(false); setArmed(false); setError('La escucha se ha interrumpido. Vuelve a activarla para empezar.'); }
    });
  };
  return <View testID="home-voice-start" style={ui.card}>
    <Text style={ui.text}>{starting ? 'Preparando tu ensayo…' : armed ? 'Di «ensayo» para empezar con tu última selección.' : 'Puedes iniciar tu última selección diciendo «ensayo».'}</Text>
    {!armed ? <Button label="Activar inicio por voz" secondary disabled={!voice.isSupported} onPress={() => { voice.prepareVoiceInput(); setError(''); setArmed(true); }} /> : <Button label="Desactivar inicio por voz" secondary onPress={() => { voice.releaseVoiceInput(); setArmed(false); }} />}
    {voice.error || error ? <><Text style={ui.error}>{error || voice.error}</Text><Button label="Reintentar inicio por voz" secondary onPress={() => { requested.current = false; setError(''); setArmed(true); voice.restartRecognition(); }} /></> : null}
  </View>;
};
