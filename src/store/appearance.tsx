import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { discardBackgroundImage } from '../api/backgroundImage';
import { paletteForBackground, type BackgroundPreference } from '../utils/appearance';
import { createWorkAppearanceStore, type WorkAppearances } from './workAppearances';

const AppearanceContext = createContext({
  background: null as BackgroundPreference | null,
  palette: paletteForBackground(null), ready: false, notice: '',
  workKey: null as string | null, workTitle: '', retryLoad: () => {},
  saveBackground: async (_background: BackgroundPreference | null) => {},
});

export const AppearanceProvider = ({ children, workKey, workTitle, legacyWorkKey }: {
  children: React.ReactNode; workKey: string | null; workTitle: string; legacyWorkKey: string | null | undefined;
}) => {
  const [backgrounds, setBackgrounds] = useState<WorkAppearances>({});
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const store = useRef<ReturnType<typeof createWorkAppearanceStore> | null>(null);
  const background = workKey ? backgrounds[workKey] ?? null : null;
  const ready = loaded && Boolean(workKey);
  const palette = useMemo(() => paletteForBackground(background?.average ?? null, background?.accent ?? background?.average ?? null), [background]);
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
    if (loaded || legacyWorkKey === undefined || (!workKey && !legacyWorkKey)) return;
    let cancelled = false;
    store.current ??= createWorkAppearanceStore(AsyncStorage, (legacyWorkKey ?? workKey)!);
    void store.current.load().then((works) => {
      if (!cancelled) { setBackgrounds(works); setLoaded(true); setNotice(''); }
    }).catch(() => { if (!cancelled) setNotice('No se pudo recuperar la apariencia de tus obras. Vuelve a intentarlo.'); });
    return () => { cancelled = true; };
  }, [legacyWorkKey, loadAttempt, loaded, workKey]);
  const saveBackground = async (next: BackgroundPreference | null) => {
    if (!workKey || !ready || !store.current) throw new Error('Abre una obra antes de elegir su fondo.');
    try {
      const result = await store.current.save(workKey, next);
      setBackgrounds(result.works); setNotice('');
      if (result.orphanedUri) await discardBackgroundImage(result.orphanedUri).catch(() => {});
    } catch {
      if (next && next.uri !== background?.uri) await discardBackgroundImage(next.uri).catch(() => {});
      throw new Error('No se pudo guardar el fondo. Libera espacio en este dispositivo y vuelve a intentarlo.');
    }
  };
  return <AppearanceContext.Provider value={{ background, palette, ready, notice, saveBackground, workKey, workTitle, retryLoad: () => setLoadAttempt((attempt) => attempt + 1) }}>{children}</AppearanceContext.Provider>;
};

export const useAppearance = () => useContext(AppearanceContext);
