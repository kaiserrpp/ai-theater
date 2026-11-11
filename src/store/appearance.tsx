import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { discardBackgroundImage } from '../api/backgroundImage';
import { paletteForBackground, type BackgroundPreference } from '../utils/appearance';
import { createWorkAppearanceStore, resolveWorkBackground, type WorkAppearances } from './workAppearances';
import { fetchSharedAppearance, saveSharedAppearance } from '../api/sharedAppearance';
import { createSharedAppearanceSession } from '../utils/sharedAppearanceSession';
import { observePageVisibility, isPageVisible } from '../utils/pageVisibility';
import { useIsAdmin } from './adminSession';
import type { SharedScriptManifest } from '../types/sharedScript';

const AppearanceContext = createContext({
  background: null as BackgroundPreference | null,
  palette: paletteForBackground(null), ready: false, notice: '',
  workKey: null as string | null, workTitle: '', retryLoad: () => {},
  isShared: false, canEdit: false,
  saveBackground: async (_background: BackgroundPreference | null) => {},
});

export const AppearanceProvider = ({ children, workKey, workTitle, legacyWorkKey, sharedScript, localWorkKey }: {
  children: React.ReactNode; workKey: string | null; workTitle: string; legacyWorkKey: string | null | undefined;
  sharedScript: SharedScriptManifest | null;
  localWorkKey: string | null;
}) => {
  const isAdmin = useIsAdmin();
  const [backgrounds, setBackgrounds] = useState<WorkAppearances>({});
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const store = useRef<ReturnType<typeof createWorkAppearanceStore> | null>(null);
  const localBackground = resolveWorkBackground(backgrounds, workKey, localWorkKey);
  const shareId = sharedScript?.shareId ?? null;
  const initialAppearance = sharedScript?.appearance;
  const sharedSession = useMemo(() => createSharedAppearanceSession({ initial: initialAppearance,
    read: () => fetchSharedAppearance(shareId!),
    write: (next, revision) => saveSharedAppearance(shareId!, next, revision),
  }), [shareId, initialAppearance]);
  const shared = useSyncExternalStore(sharedSession.subscribe, sharedSession.getSnapshot, sharedSession.getSnapshot);
  const background = shareId && shared.appearance.revision > 0 ? shared.appearance.background : localBackground;
  const ready = loaded && Boolean(workKey);
  const canEdit = ready && (!shareId || isAdmin);
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
  useEffect(() => {
    if (!shareId || !loaded) return;
    const refresh = () => { if (isPageVisible()) void sharedSession.refresh(isAdmin, localBackground); };
    refresh();
    const stop = observePageVisibility((visible) => { if (visible) refresh(); });
    const timer = setInterval(refresh, 30000);
    return () => { stop(); clearInterval(timer); };
  }, [isAdmin, loaded, localBackground, shareId, sharedSession]);
  useEffect(() => {
    if (!shareId || !workKey || !loaded || !store.current || shared.appearance.revision === 0 ||
        JSON.stringify(localBackground) === JSON.stringify(shared.appearance.background)) return;
    // Remember the last shared appearance; cache failure cannot undo a save.
    void store.current.save(workKey, shared.appearance.background).then(async (result) => {
      setBackgrounds(result.works);
      if (result.orphanedUri) await discardBackgroundImage(result.orphanedUri).catch(() => {});
    }).catch(() => setNotice('El fondo está compartido, pero no se pudo guardar una copia en este dispositivo.'));
  }, [loaded, localBackground, shareId, shared.appearance, workKey]);
  const saveBackground = async (next: BackgroundPreference | null) => {
    if (!workKey || !ready || !store.current) throw new Error('Abre una obra antes de elegir su fondo.');
    if (shareId) {
      if (!isAdmin) throw new Error('Activa el acceso de administración para cambiar el fondo compartido.');
      try {
        await sharedSession.save(next);
        setNotice('');
        if (next && next.uri !== localBackground?.uri) await discardBackgroundImage(next.uri).catch(() => {});
      } catch (error) {
        if (next && next.uri !== localBackground?.uri) await discardBackgroundImage(next.uri).catch(() => {});
        throw error;
      }
      return;
    }
    try {
      const result = await store.current.save(workKey, next);
      setBackgrounds(result.works); setNotice('');
      if (result.orphanedUri) await discardBackgroundImage(result.orphanedUri).catch(() => {});
    } catch {
      if (next && next.uri !== background?.uri) await discardBackgroundImage(next.uri).catch(() => {});
      throw new Error('No se pudo guardar el fondo. Libera espacio en este dispositivo y vuelve a intentarlo.');
    }
  };
  return <AppearanceContext.Provider value={{ background, palette, ready, canEdit, isShared: Boolean(shareId),
    notice: notice || (shareId ? shared.notice : ''), saveBackground, workKey, workTitle, retryLoad: () => {
      setLoadAttempt((attempt) => attempt + 1);
      if (shareId) void sharedSession.retry(isAdmin, localBackground);
    } }}>{children}</AppearanceContext.Provider>;
};

export const useAppearance = () => useContext(AppearanceContext);
