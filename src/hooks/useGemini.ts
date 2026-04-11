import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import { analyzeScriptLocally } from '../api/localScriptAnalyzer';
import {
  analyzeScriptInStages as runScriptAnalysis,
  fetchAvailableGeminiModels,
} from '../api/geminiScriptAnalyzer';
import { PENDING_ANALYSIS_STORAGE_KEY } from '../store/storageKeys';
import type { PendingAnalysisJob, ScriptData } from '../types/script';

export type { Dialogue, PendingAnalysisJob, ScriptData } from '../types/script';

export const useGemini = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scriptData, setScriptData] = useState<ScriptData | null>(null);
  const [statusText, setStatusText] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [sceneTitles, setSceneTitles] = useState<string[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(-1);
  const [pendingJob, setPendingJob] = useState<PendingAnalysisJob | null>(null);

  const loadPendingJob = useCallback(async () => {
    try {
      const storedValue = await AsyncStorage.getItem(PENDING_ANALYSIS_STORAGE_KEY);
      if (!storedValue) {
        setPendingJob(null);
        return null;
      }

      const parsedJob = JSON.parse(storedValue) as PendingAnalysisJob;
      setPendingJob(parsedJob);
      return parsedJob;
    } catch (loadError) {
      console.warn('No se pudo cargar el checkpoint pendiente.', loadError);
      setPendingJob(null);
      return null;
    }
  }, []);

  const persistCheckpoint = useCallback(async (job: PendingAnalysisJob) => {
    await AsyncStorage.setItem(PENDING_ANALYSIS_STORAGE_KEY, JSON.stringify(job));
    setPendingJob(job);
  }, []);

  const clearCheckpoint = useCallback(async () => {
    await AsyncStorage.removeItem(PENDING_ANALYSIS_STORAGE_KEY);
    setPendingJob(null);
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      const storedJob = await loadPendingJob();
      if (Platform.OS === 'web' && !storedJob) {
        return;
      }

      const models = await fetchAvailableGeminiModels();
      if (models.length > 0) {
        setAvailableModels(models);
      }
    };

    void bootstrap();
  }, [loadPendingJob]);

  const analyzeInStages = useCallback(
    async (localUri: string | null, resumeData?: PendingAnalysisJob | null) => {
      setLoading(true);
      setError(null);
      setStatusText('');
      setSceneTitles(resumeData?.totalChunks ?? []);
      setCurrentChunkIndex(resumeData?.index ?? -1);
      setScriptData(resumeData?.data ?? null);

      try {
        if (Platform.OS === 'web' && localUri && !resumeData) {
          await clearCheckpoint();

          const finalScript = await analyzeScriptLocally(localUri, {
            onStatusChange: setStatusText,
            onPagesReady: setSceneTitles,
            onPageStart: (index) => setCurrentChunkIndex(index),
          });

          setScriptData(finalScript);
          return;
        }

        const finalScript = await runScriptAnalysis({
          localUri,
          resumeJob: resumeData,
          preferredModels: availableModels,
          callbacks: {
            onStatusChange: setStatusText,
            onScenesReady: setSceneTitles,
            onSceneStart: (index) => setCurrentChunkIndex(index),
            onSceneComplete: async (updatedScript, checkpoint) => {
              setScriptData({ ...updatedScript });
              await persistCheckpoint(checkpoint);
            },
          },
        });

        setScriptData(finalScript);
        await clearCheckpoint();
      } catch (analysisError) {
        const message = analysisError instanceof Error ? analysisError.message : 'Error desconocido.';
        setError(`Error de lectura: ${message}`);
      } finally {
        setLoading(false);
      }
    },
    [availableModels, clearCheckpoint, persistCheckpoint]
  );

  const resumePendingJob = useCallback(async () => {
    if (!pendingJob) {
      return;
    }

    await analyzeInStages(null, pendingJob);
  }, [analyzeInStages, pendingJob]);

  const resetScript = useCallback(() => {
    setScriptData(null);
    setError(null);
    setStatusText('');
    setSceneTitles([]);
    setCurrentChunkIndex(-1);
  }, []);

  return {
    analyzeInStages,
    loading,
    error,
    scriptData,
    statusText,
    currentChunkIndex,
    totalChunks: sceneTitles.length,
    pendingJob,
    resumePendingJob,
    discardPendingJob: clearCheckpoint,
    resetScript,
  };
};
