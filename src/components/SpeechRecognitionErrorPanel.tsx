import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getSpeechRecognitionPermissionHelp } from '../utils/speechRecognitionPermissionHelp';
import { usePracticeTheme } from './PracticeUI';
import type { PracticePalette } from '../utils/appearance';

type Props = {
  error: string;
  errorCode: string | null;
  errorDetail: string | null;
  onRetry: () => void;
  retryLabel: string;
};

export const SpeechRecognitionErrorPanel = ({ error, errorCode, errorDetail, onRetry, retryLabel }: Props) => {
  const { palette } = usePracticeTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [showDetails, setShowDetails] = useState(false);
  const device = useMemo(() => typeof navigator === 'undefined'
    ? { userAgent: '' }
    : { userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }, []);
  const help = getSpeechRecognitionPermissionHelp(errorCode, errorDetail, device);

  return <View style={styles.panel} testID="speech-recognition-error">
    {help ? <>
      <Text style={styles.title} accessibilityRole="header">Activa el permiso de voz</Text>
      <Text style={styles.text}>
        Abre Ajustes en el iPhone o iPad y sigue esta ruta para autorizar a {help.browserName}:
      </Text>
      <Text style={styles.route} selectable>{help.settingsPath}</Text>
      {help.steps.map((step, index) => <View key={step} style={styles.step}>
        <Text style={styles.number}>{index + 1}.</Text>
        <Text style={styles.stepText}>{step}</Text>
      </View>)}
      <Text style={styles.hint}>Se conservan tu escena, personaje y punto de ensayo.</Text>
    </> : <Text style={styles.error}>{error}</Text>}
    <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={onRetry}>
      <Text style={styles.buttonText}>{help ? 'Ya lo he activado, comprobar' : retryLabel}</Text>
    </TouchableOpacity>
    {errorCode || errorDetail ? <>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: showDetails }}
        onPress={() => setShowDetails((previous) => !previous)} style={styles.detailsButton}>
        <Text style={styles.detailsLink}>{showDetails ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}</Text>
      </TouchableOpacity>
      {showDetails ? <Text style={styles.details} selectable>
        Detalle del navegador: {[errorCode, errorDetail].filter(Boolean).join(' · ')}
      </Text> : null}
    </> : null}
  </View>;
};

const createStyles = (palette: PracticePalette) => StyleSheet.create({
  panel: { gap: 14, width: '100%' },
  title: { fontSize: 21, lineHeight: 28, fontWeight: '800', color: palette.ink, textAlign: 'center' },
  text: { color: palette.sub, fontSize: 15, lineHeight: 23 },
  route: { padding: 12, borderRadius: 10, backgroundColor: palette.soft, color: palette.plum, fontWeight: '700', fontSize: 15, lineHeight: 24 },
  step: { flexDirection: 'row', gap: 9 },
  number: { color: palette.plum, fontWeight: '800', lineHeight: 23 },
  stepText: { flex: 1, color: palette.sub, fontSize: 15, lineHeight: 23 },
  hint: { color: palette.sub, fontSize: 13, lineHeight: 20 },
  error: { color: palette.error, lineHeight: 23 },
  button: { paddingHorizontal: 12, paddingVertical: 15, borderRadius: 11, backgroundColor: '#176aa3', alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, lineHeight: 23, fontWeight: '700', textAlign: 'center' },
  detailsButton: { paddingVertical: 5, alignItems: 'center' },
  detailsLink: { color: palette.plum, textDecorationLine: 'underline', lineHeight: 21 },
  details: { color: palette.sub, fontSize: 12, lineHeight: 18 },
});
