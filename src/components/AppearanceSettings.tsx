import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { prepareBackgroundImage } from '../api/backgroundImage';
import { useAppearance } from '../store/appearance';
import { Button, usePracticeTheme } from './PracticeUI';

export const AppearanceSettings = ({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) => {
  const { background, ready, notice, saveBackground, workKey, workTitle, retryLoad } = useAppearance();
  const { palette, ui } = usePracticeTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  useEffect(() => { setError(''); setSaved(''); }, [workKey]);
  const changeBackground = async (remove = false) => {
    setBusy(true); onBusyChange(true); setError(''); setSaved('');
    try {
      if (remove) {
        await saveBackground(null);
        setSaved('Esta obra vuelve a usar el fondo original.');
      } else {
        const result = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'image/webp'], multiple: false, copyToCacheDirectory: true, base64: false });
        if (result.canceled) return;
        await saveBackground(await prepareBackgroundImage(result.assets[0]));
        setSaved(`Fondo guardado para ${workTitle}. Los colores se han adaptado automáticamente.`);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cambiar el fondo. Prueba con otra imagen.'); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <>
    {workKey ? <><Text style={ui.label}>APARIENCIA DE ESTA OBRA</Text><Text style={ui.subtitle}>{workTitle}</Text></> : null}
    <Text style={ui.text}>{workKey ? 'Elige una foto o el cartel de esta obra. Los menús, textos y botones tomarán sus colores, manteniendo el contraste.' : 'Abre una obra para elegir su fondo y sus colores.'}</Text>
    {background ? <View style={ui.card}>
      <Image source={{ uri: background.uri }} accessibilityLabel="Fondo elegido" style={{ width: '100%', height: 160, borderRadius: 12 }} contentFit="cover" />
      <Text numberOfLines={2} style={ui.text}>{background.name}</Text>
      <Text style={ui.label}>{palette.isDark ? 'TONOS CLAROS DEL FONDO' : 'TONOS OSCUROS DEL FONDO'}</Text>
    </View> : <Text style={ui.text}>Estás usando el fondo original.</Text>}
    <Button label={busy ? 'Preparando fondo…' : background ? 'Cambiar imagen' : 'Seleccionar imagen'} disabled={busy || !ready} onPress={() => void changeBackground()} />
    {background ? <Button label="Restaurar fondo original" secondary disabled={busy || !ready} onPress={() => void changeBackground(true)} /> : null}
    <Text style={ui.text}>Cada obra recuerda su propia imagen y sus colores en este dispositivo. Al cambiar de obra se recupera su apariencia. Admite JPG, PNG y WebP de hasta 20 MB.</Text>
    {notice || error ? <Text accessibilityRole="alert" style={ui.error}>{error || notice}</Text> : null}
    {notice && !ready ? <Button label="Reintentar carga de apariencias" secondary onPress={retryLoad} /> : null}
    {saved ? <Text accessibilityLiveRegion="polite" style={ui.text}>{saved}</Text> : null}
  </>;
};
