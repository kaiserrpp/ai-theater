import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { discardBackgroundImage } from '../api/backgroundImage';
import { paletteForBackground, parseBackgroundPreference, type BackgroundPreference } from '../utils/appearance';
import { BACKGROUND_STORAGE_KEY } from './storageKeys';

const AppearanceContext = createContext({
  background: null as BackgroundPreference | null,
  palette: paletteForBackground(null), ready: false, notice: '',
  saveBackground: async (_background: BackgroundPreference | null) => {},
});

export const AppearanceProvider = ({ children }: { children: React.ReactNode }) => {
  const [background, setBackground] = useState<BackgroundPreference | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const palette = useMemo(() => paletteForBackground(background?.average ?? null), [background]);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const previousColor = document.body.style.backgroundColor;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    const previousTheme = themeColor?.getAttribute('content');
    document.body.style.backgroundColor = palette.bg;
    themeColor?.setAttribute('content', palette.bg);
    return () => {
      document.body.style.backgroundColor = previousColor;
      if (previousTheme) themeColor?.setAttribute('content', previousTheme);
    };
  }, [palette.bg]);
  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(BACKGROUND_STORAGE_KEY).then((stored) => {
      if (!cancelled) setBackground(parseBackgroundPreference(stored));
    }).catch(() => { if (!cancelled) setNotice('No se pudo recuperar el fondo guardado. Puedes volver a elegirlo.'); })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);
  const saveBackground = async (next: BackgroundPreference | null) => {
    try {
      if (next) await AsyncStorage.setItem(BACKGROUND_STORAGE_KEY, JSON.stringify(next));
      else await AsyncStorage.removeItem(BACKGROUND_STORAGE_KEY);
    } catch {
      if (next && next.uri !== background?.uri) await discardBackgroundImage(next.uri).catch(() => {});
      throw new Error('No se pudo guardar el fondo. Libera espacio en este dispositivo y vuelve a intentarlo.');
    }
    const previous = background;
    setBackground(next); setNotice('');
    if (previous && previous.uri !== next?.uri) await discardBackgroundImage(previous.uri).catch(() => {});
  };
  return <AppearanceContext.Provider value={{ background, palette, ready, notice, saveBackground }}>{children}</AppearanceContext.Provider>;
};

export const useAppearance = () => useContext(AppearanceContext);
