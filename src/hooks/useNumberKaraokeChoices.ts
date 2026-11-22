import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { numberKaraokeKey } from '../utils/musicalNumberPractice';

type Choices = Record<string, string>;
type LocalChoices = { key: string; entries: Choices };
const empty: Choices = {};
let pendingSave = Promise.resolve();

export const useNumberKaraokeChoices = (shareId: string | null) => {
  const key = shareId ? `@teatro_ia_number_karaoke:${shareId}` : null;
  const [stored, setStored] = useState<LocalChoices | null>(null);
  const [changed, setChanged] = useState<LocalChoices | null>(null);
  const current = changed?.key === key ? changed : stored?.key === key ? stored : null;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    void pendingSave.then(() => AsyncStorage.getItem(key)).then((raw) => {
      const entries = raw ? JSON.parse(raw) : {};
      if (!cancelled) setStored({ key, entries: Object.fromEntries(Object.entries(entries ?? {})
        .filter(([, value]) => typeof value === 'string')) as Choices });
    }).catch(() => { if (!cancelled) setStored({ key, entries: {} }); });
    return () => { cancelled = true; };
  }, [key]);

  useEffect(() => {
    if (!changed) return;
    pendingSave = pendingSave.then(() => AsyncStorage.setItem(changed.key, JSON.stringify(changed.entries)))
      .catch(() => {});
  }, [changed]);

  const remember = useCallback((numberId: string, character: string, audioId: string) => {
    if (!key || stored?.key !== key) return;
    setChanged((previous) => ({ key, entries: {
      ...(previous?.key === key ? previous.entries : stored.entries),
      [numberKaraokeKey(numberId, character)]: audioId,
    } }));
  }, [key, stored]);

  return { loaded: !key || Boolean(current), entries: current?.entries ?? empty, remember };
};

export type NumberKaraokeChoices = ReturnType<typeof useNumberKaraokeChoices>;
