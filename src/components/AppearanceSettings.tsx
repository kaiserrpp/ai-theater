import * as DocumentPicker from 'expo-document-picker';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { prepareBackgroundImage } from '../api/backgroundImage';
import { useAppearance } from '../store/appearance';
import { Button, usePracticeTheme } from './PracticeUI';
import { AdminAccessPanel } from './AdminAccessPanel';

export const AppearanceSettings = ({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) => {
  const { background, ready, notice, saveBackground, workKey, workTitle, retryLoad, isShared, canEdit } = useAppearance();
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
        setSaved(isShared ? 'Esta obra vuelve a usar el fondo original en todos los dispositivos.' : 'Esta obra vuelve a usar el fondo original.');
      } else {
        const result = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'image/webp'], multiple: false, copyToCacheDirectory: true, base64: false });
        if (result.canceled) return;
        await saveBackground(await prepareBackgroundImage(result.assets[0]));
        setSaved(isShared ? `Fondo compartido para ${workTitle}. Está disponible en todos los dispositivos.` : `Fondo guardado para ${workTitle}. Los colores se han adaptado automáticamente.`);
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
    <Button label={busy ? 'Guardando fondo…' : background ? 'Cambiar imagen' : 'Seleccionar imagen'} disabled={busy || !ready || !canEdit} onPress={() => void changeBackground()} />
    {background ? <Button label="Restaurar fondo original" secondary disabled={busy || !ready || !canEdit} onPress={() => void changeBackground(true)} /> : null}
    <Text style={ui.text}>{isShared ? 'La imagen y los colores de esta obra se comparten con todos los dispositivos. Cambiar o restaurar el fondo actualiza la apariencia del grupo.' : 'Esta obra todavía es local. Su imagen y sus colores estarán disponibles en este dispositivo hasta que publiques la obra.'} Admite JPG, PNG y WebP de hasta {Platform.OS === 'web' ? '20' : '3'} MB.</Text>
    {isShared && !canEdit && ready ? <>
      <Text style={ui.text}>Para cambiar el fondo del grupo o compartir la imagen que tenías guardada, activa el acceso de administración.</Text>
      <AdminAccessPanel />
    </> : null}
    {notice || error ? <Text accessibilityRole="alert" style={ui.error}>{error || notice}</Text> : null}
    {notice ? <Button label="Reintentar carga de apariencias" secondary disabled={busy} onPress={retryLoad} /> : null}
    {saved ? <Text accessibilityLiveRegion="polite" style={ui.text}>{saved}</Text> : null}
  </>;
};
