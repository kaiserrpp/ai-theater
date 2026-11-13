import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBrowserRehearsalComparison } from '../utils/rehearsalComparison';
import type { ComparisonSnapshot, RehearsalComparisonResult } from '../utils/rehearsalComparisonSession';
import type { ScriptRecognitionContext } from '../utils/scriptRecognitionContext';
import { isPageVisible } from '../utils/pageVisibility';

type Options = { selected: boolean; enabled: boolean; pageVisible: boolean; lineKey: string | null; lang: string;
  context: ScriptRecognitionContext; speechThreshold: number; onResult: (result: RehearsalComparisonResult) => void };
export const useRehearsalComparison = (options: Options) => {
  const current = useRef(options); current.current = options;
  const [snapshot, setSnapshot] = useState<ComparisonSnapshot>({ phase: 'idle', results: [], message: '' });
  const [retry, setRetry] = useState(0);
  const session = useMemo(() => typeof window === 'undefined' ? null : createBrowserRehearsalComparison({
    onChange: setSnapshot, onResult: result => current.current.onResult(result), speechThreshold: () => current.current.speechThreshold,
  }), []);
  useEffect(() => {
    if (!session) return;
    if (!options.selected || !options.enabled || !options.lineKey || !options.pageVisible) {
      session.suspend(); if (!options.pageVisible) session.abandonNativeOnHide(); return;
    }
    const key = `${options.lineKey}:${retry}`;
    void session.open({ key, id: `parallel-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      lang: current.current.lang, context: current.current.context }).catch(error => {
      setSnapshot(previous => ({ ...previous, phase: 'error', message: error.message || 'No se pudo preparar la comparativa.' }));
    });
  }, [options.selected, options.enabled, options.pageVisible, options.lineKey, retry, session]);
  useEffect(() => () => { session?.finish('exit'); session?.dispose(); }, [session]);
  const finish = useCallback((reason: 'button' | 'manual' | 'exit' = 'manual') => session?.finish(reason), [session]);
  return { ...snapshot, finish,
    stop: useCallback(() => session?.suspend(), [session]),
    restart: useCallback(() => { session?.finish('manual'); setRetry(value => value + 1); }, [session]),
    waitForEnd: useCallback(() => session?.waitForEnd() || Promise.resolve(true), [session]),
    notifyPlaybackEnd: useCallback(() => session?.notifyPlaybackEnd(), [session]),
    canAdvance: options.enabled && isPageVisible(),
  };
};
