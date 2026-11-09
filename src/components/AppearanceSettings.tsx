import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { prepareBackgroundImage } from '../api/backgroundImage';
import { useAppearance } from '../store/appearance';
import { Button, usePracticeTheme } from './PracticeUI';

export const AppearanceSettings = ({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) => {
  const { background, ready, notice, saveBackground } = useAppearance();
  const { palette, ui } = usePracticeTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const changeBackground = async (remove = false) => {
    setBusy(true); onBusyChange(true); setError(''); setSaved('');
    try {
      if (remove) {
        await saveBackground(null);
        setSaved('Se ha recuperado el fondo original.');
      } else {
        const result = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'image/webp'], multiple: false, copyToCacheDirectory: true, base64: false });
        if (result.canceled) return;
        await saveBackground(await prepareBackgroundImage(result.assets[0]));
        setSaved('Fondo guardado. Los colores se han adaptado automáticamente.');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cambiar el fondo. Prueba con otra imagen.'); }
    finally { setBusy(false); onBusyChange(false); }
  };
  return <>
    <Text style={ui.text}>Elige una foto o el cartel de tu obra. La app adapta textos y botones y suaviza el fondo para facilitar la lectura.</Text>
    {background ? <View style={ui.card}>
      <Image source={{ uri: background.uri }} accessibilityLabel="Fondo elegido" style={{ width: '100%', height: 160, borderRadius: 12 }} contentFit="cover" />
      <Text numberOfLines={2} style={ui.text}>{background.name}</Text>
      <Text style={ui.label}>{palette.ink === '#ffffff' ? 'COLORES CLAROS SOBRE FONDO OSCURO' : 'COLORES OSCUROS SOBRE FONDO CLARO'}</Text>
    </View> : <Text style={ui.text}>Estás usando el fondo original.</Text>}
    <Button label={busy ? 'Preparando fondo…' : background ? 'Cambiar imagen' : 'Seleccionar imagen'} disabled={busy || !ready} onPress={() => void changeBackground()} />
    {background ? <Button label="Restaurar fondo original" secondary disabled={busy || !ready} onPress={() => void changeBackground(true)} /> : null}
    <Text style={ui.text}>Se guarda solo en este dispositivo y se mantiene al cambiar de obra. Admite JPG, PNG y WebP de hasta 20 MB.</Text>
    {notice || error ? <Text accessibilityRole="alert" style={ui.error}>{error || notice}</Text> : null}
    {saved ? <Text accessibilityLiveRegion="polite" style={ui.text}>{saved}</Text> : null}
  </>;
};
