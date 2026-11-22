import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import type { WarmupPreferences } from '../types/warmup';
import { restoreWarmupPreferences, voicePreferences } from '../utils/warmup';

const defaultPreferences = voicePreferences('baritone');
let pendingSave = Promise.resolve();

type StoredSettings = { key: string; preferences: WarmupPreferences; error: string };

export const useWarmupPreferences = (shareId: string | null) => {
  const key = shareId ? `@teatro_ia_warmup_v1:${shareId}` : null;
  const [settings, setSettings] = useState<StoredSettings | null>(null);
  const current = settings?.key === key ? settings : null;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const finish = (preferences: WarmupPreferences, error = '') => {
      if (!cancelled) setSettings({ key, preferences, error });
    };
    void pendingSave.then(() => AsyncStorage.getItem(key))
      .then((value) => finish(value ? restoreWarmupPreferences(JSON.parse(value)) : defaultPreferences))
      .catch(() => finish(defaultPreferences, 'No se pudo recuperar tu ajuste de calentamiento.'));
    return () => { cancelled = true; };
  }, [key]);

  const save = (preferences: WarmupPreferences) => {
    if (!key) return;
    setSettings({ key, preferences, error: '' });
    // Keep writes ordered even if the warmup or the song library closes.
    pendingSave = pendingSave.then(() => AsyncStorage.setItem(key, JSON.stringify(preferences)))
      .catch(() => setSettings((latest) => latest?.key === key && latest.preferences === preferences
        ? { ...latest, error: 'No se pudo guardar el ajuste en este dispositivo.' }
        : latest));
  };

  return {
    preferences: current?.preferences ?? defaultPreferences,
    loaded: !key || Boolean(current),
    storageError: current?.error ?? '',
    save,
  };
};

export type WarmupSettings = ReturnType<typeof useWarmupPreferences>;
