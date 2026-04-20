import * as DocumentPicker from 'expo-document-picker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  fetchSharedScriptList,
  fetchSharedScript,
  getSharedScriptIdFromUrl,
  publishSharedScript,
  replaceSharedScriptIdInUrl,
} from '../api/sharedScripts';
import { RehearsalView } from '../components/RehearsalView';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { SongManagerPanel } from '../components/SongManagerPanel';
import { VersionBadge } from '../components/VersionBadge';
import { SavedScript, useLibrary } from '../hooks/useLibrary';
import { useGemini } from '../hooks/useGemini';
import { useScriptRoleMerges } from '../hooks/useScriptRoleMerges';
import { RehearsalCheckpoint, RehearsalCheckpointMap, RehearsalMode, SavedScriptConfig } from '../types/script';
import { SharedScriptListItem, SharedScriptManifest } from '../types/sharedScript';
import { getScriptIdentity } from '../utils/scriptIdentity';
import { CharacterMergeMap, normalizeRoleSelection } from '../utils/scriptRoleMerges';
import {
  syncSharedMusicalNumbersWithScript,
  syncSharedSongsWithScript,
} from '../utils/sharedSongs';
import { areSceneSelectionsEqual, filterScriptByScenes, getSceneTitles, getScenesForRolesAndSongs } from '../utils/scriptScenes';

const createEmptyRehearsalCheckpoints = (): RehearsalCheckpointMap => ({
  ALL: null,
  MINE: null,
  SELECTED: null,
});

const areMergeMapsEqual = (leftMap: CharacterMergeMap, rightMap: CharacterMergeMap) => {
  const leftEntries = Object.entries(leftMap).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  const rightEntries = Object.entries(rightMap).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([leftKey, leftValue], index) => {
    const [rightKey, rightValue] = rightEntries[index];
    return leftKey === rightKey && leftValue === rightValue;
  });
};

const buildSharedScriptSummaryFromManifest = (
  manifest: SharedScriptManifest
): SharedScriptListItem => ({
  shareId: manifest.shareId,
  obra: manifest.scriptData.obra,
  fileName: manifest.fileName,
  mergeCount: Object.keys(manifest.mergeMap).length,
  songCount: manifest.songs.length,
  createdAt: manifest.createdAt,
  updatedAt: manifest.updatedAt,
});

const upsertSharedScriptSummary = (
  previousScripts: SharedScriptListItem[],
  nextScript: SharedScriptListItem
) => {
  const remainingScripts = previousScripts.filter((script) => script.shareId !== nextScript.shareId);
  return [nextScript, ...remainingScripts].sort((leftScript, rightScript) =>
    rightScript.updatedAt.localeCompare(leftScript.updatedAt)
  );
};

const formatSharedScriptTimestamp = (value: string) => {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return 'Actualizada recientemente';
  }

  return `Actualizada ${timestamp.toLocaleString('es-ES', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}`;
};

const cloneSavedScriptConfig = (config: SavedScriptConfig): SavedScriptConfig => ({
  myRoles: [...config.myRoles],
  selectedScenes: [...config.selectedScenes],
  lastRehearsalMode: config.lastRehearsalMode,
  rehearsalCheckpoints: {
    ALL: config.rehearsalCheckpoints.ALL ? { ...config.rehearsalCheckpoints.ALL, sceneFilter: [...config.rehearsalCheckpoints.ALL.sceneFilter] } : null,
    MINE: config.rehearsalCheckpoints.MINE ? { ...config.rehearsalCheckpoints.MINE, sceneFilter: [...config.rehearsalCheckpoints.MINE.sceneFilter] } : null,
    SELECTED: config.rehearsalCheckpoints.SELECTED ? { ...config.rehearsalCheckpoints.SELECTED, sceneFilter: [...config.rehearsalCheckpoints.SELECTED.sceneFilter] } : null,
  },
  sharedScriptId: config.sharedScriptId,
});

export const HomeScreen = () => {
  const {
    analyzeInStages,
    loading,
    error,
    scriptData,
    statusText,
    currentChunkIndex,
    totalChunks,
    pendingJob,
    resumePendingJob,
    discardPendingJob,
    loadSavedScript,
    resetScript,
  } = useGemini();
  const { savedScripts, saveScript, deleteScript } = useLibrary();

  const [currentScriptFileName, setCurrentScriptFileName] = useState<string | null>(null);
  const [myRoles, setMyRoles] = useState<string[]>([]);
  const [isRehearsing, setIsRehearsing] = useState(false);
  const [selectedScenes, setSelectedScenes] = useState<string[]>([]);
  const [activeRehearsalScenes, setActiveRehearsalScenes] = useState<string[]>([]);
  const [activeRehearsalMode, setActiveRehearsalMode] = useState<RehearsalMode | null>(null);
  const [rehearsalStartIndex, setRehearsalStartIndex] = useState(0);
  const [lastRehearsalMode, setLastRehearsalMode] = useState<RehearsalMode | null>(null);
  const [rehearsalCheckpoints, setRehearsalCheckpoints] = useState<RehearsalCheckpointMap>(
    createEmptyRehearsalCheckpoints()
  );
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [isRolePanelVisible, setIsRolePanelVisible] = useState(false);
  const [isScenePanelVisible, setIsScenePanelVisible] = useState(false);
  const [isMergePanelVisible, setIsMergePanelVisible] = useState(false);
  const [isSavedScriptsPanelVisible, setIsSavedScriptsPanelVisible] = useState(false);
  const [isSharedScriptsPanelVisible, setIsSharedScriptsPanelVisible] = useState(false);
  const [isManagingSongs, setIsManagingSongs] = useState(false);
  const [pendingResumeMode, setPendingResumeMode] = useState<RehearsalMode | null>(null);
  const [sharedScript, setSharedScript] = useState<SharedScriptManifest | null>(null);
  const [sharedStatusText, setSharedStatusText] = useState('');
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [isSharingScript, setIsSharingScript] = useState(false);
  const [isLoadingSharedScript, setIsLoadingSharedScript] = useState(false);
  const [isHydratingSharedMergeMap, setIsHydratingSharedMergeMap] = useState(false);
  const [sharedScriptsCatalog, setSharedScriptsCatalog] = useState<SharedScriptListItem[]>([]);
  const [selectedSharedScriptId, setSelectedSharedScriptId] = useState<string | null>(null);
  const [isLoadingSharedScriptsCatalog, setIsLoadingSharedScriptsCatalog] = useState(false);
  const [sharedScriptsCatalogError, setSharedScriptsCatalogError] = useState<string | null>(null);

  const {
    isReady: areRoleMergesReady,
    mergeEntries,
    mergeMap,
    mergeSourceCandidates,
    mergedScriptData,
    mergeCharacter,
    removeMerge,
    clearMerges,
  } = useScriptRoleMerges(scriptData, sharedScript ? {
    mode: 'managed',
    initialMergeMap: sharedScript.mergeMap,
  } : undefined);

  const displayScriptData = mergedScriptData ?? scriptData;
  const effectiveError = sharedError ?? error;
  const effectiveLoading = loading || isLoadingSharedScript || isSharingScript;

  const progressText = useMemo(() => {
    if (!effectiveLoading) {
      return '';
    }

    if (loading && totalChunks > 0 && currentChunkIndex >= 0) {
      return `${statusText} (${currentChunkIndex + 1}/${totalChunks})`;
    }

    if (loading) {
      return statusText;
    }

    return sharedStatusText;
  }, [currentChunkIndex, effectiveLoading, loading, sharedStatusText, statusText, totalChunks]);

  const selectedSharedScriptSummary = useMemo(() => {
    if (sharedScriptsCatalog.length === 0) {
      return null;
    }

    if (selectedSharedScriptId) {
      const matchingScript = sharedScriptsCatalog.find((script) => script.shareId === selectedSharedScriptId);
      if (matchingScript) {
        return matchingScript;
      }
    }

    if (sharedScript) {
      const activeScript = sharedScriptsCatalog.find((script) => script.shareId === sharedScript.shareId);
      if (activeScript) {
        return activeScript;
      }
    }

    return sharedScriptsCatalog[0];
  }, [selectedSharedScriptId, sharedScript, sharedScriptsCatalog]);

  const currentSceneTitles = useMemo(
    () => (displayScriptData ? getSceneTitles(displayScriptData.guion) : []),
    [displayScriptData]
  );

  const mergeTargetCandidates = useMemo(() => {
    if (!displayScriptData || !mergeSource) {
      return [];
    }

    const currentAlias = normalizeRoleSelection([mergeSource], mergeMap)[0] ?? mergeSource;
    return displayScriptData.personajes.filter((character) => character !== currentAlias);
  }, [displayScriptData, mergeMap, mergeSource]);

  const getApplicableCheckpoint = useCallback(
    (mode: RehearsalMode, sceneFilter: string[]) => {
      const checkpoint = rehearsalCheckpoints[mode];
      if (!checkpoint || checkpoint.lineIndex <= 0) {
        return null;
      }

      return areSceneSelectionsEqual(checkpoint.sceneFilter, sceneFilter)
        ? checkpoint
        : null;
    },
    [rehearsalCheckpoints]
  );

  const selectedScenesSummary = useMemo(() => {
    if (selectedScenes.length === 0) {
      return 'Todavia no has elegido escenas concretas';
    }

    if (selectedScenes.length === 1) {
      return selectedScenes[0];
    }

    if (selectedScenes.length <= 3) {
      return selectedScenes.join(', ');
    }

    return `${selectedScenes.length} escenas seleccionadas`;
  }, [selectedScenes]);

  const pendingResumeScenes = useMemo(() => {
    if (!displayScriptData || !pendingResumeMode) {
      return [];
    }

    if (pendingResumeMode === 'ALL') {
      return getSceneTitles(displayScriptData.guion);
    }

    if (pendingResumeMode === 'MINE') {
      return getScenesForRolesAndSongs(displayScriptData.guion, myRoles, sharedScript?.songs ?? []);
    }

    return selectedScenes;
  }, [displayScriptData, myRoles, pendingResumeMode, selectedScenes, sharedScript?.songs]);

  const pendingResumeTotalLines = useMemo(() => {
    if (!displayScriptData || pendingResumeScenes.length === 0) {
      return 0;
    }

    return filterScriptByScenes(displayScriptData.guion, pendingResumeScenes).length;
  }, [displayScriptData, pendingResumeScenes]);

  const pendingResumeCheckpoint = useMemo(
    () => (pendingResumeMode ? getApplicableCheckpoint(pendingResumeMode, pendingResumeScenes) : null),
    [getApplicableCheckpoint, pendingResumeMode, pendingResumeScenes]
  );

  useEffect(() => {
    setMyRoles((previousRoles) => normalizeRoleSelection(previousRoles, mergeMap));
  }, [mergeMap]);

  useEffect(() => {
    if (!displayScriptData) {
      return;
    }

    setMyRoles((previousRoles) =>
      previousRoles.filter((role) => displayScriptData.personajes.includes(role))
    );
    setSelectedScenes((previousScenes) =>
      previousScenes.filter((sceneTitle) => currentSceneTitles.includes(sceneTitle))
    );
    setActiveRehearsalScenes((previousScenes) =>
      previousScenes.filter((sceneTitle) => currentSceneTitles.includes(sceneTitle))
    );
  }, [currentSceneTitles, displayScriptData]);

  useEffect(() => {
    if (mergeSource && !mergeSourceCandidates.includes(mergeSource)) {
      setMergeSource(null);
    }
  }, [mergeSource, mergeSourceCandidates]);

  useEffect(() => {
    if (mergeTarget && !mergeTargetCandidates.includes(mergeTarget)) {
      setMergeTarget(null);
    }
  }, [mergeTarget, mergeTargetCandidates]);

  useEffect(() => {
    if (!scriptData || effectiveLoading) {
      return;
    }

    const fileName = currentScriptFileName ?? scriptData.obra;
    void saveScript(fileName, scriptData, {
      myRoles,
      selectedScenes,
      lastRehearsalMode,
      rehearsalCheckpoints,
      sharedScriptId: sharedScript?.shareId ?? null,
    });
  }, [
    currentScriptFileName,
    effectiveLoading,
    lastRehearsalMode,
    myRoles,
    rehearsalCheckpoints,
    saveScript,
    sharedScript?.shareId,
    scriptData,
    selectedScenes,
  ]);

  const getScenesForMode = useCallback(
    (mode: RehearsalMode) => {
      if (!displayScriptData) {
        return [];
      }

      if (mode === 'ALL') {
        return getSceneTitles(displayScriptData.guion);
      }

      if (mode === 'MINE') {
        return getScenesForRolesAndSongs(displayScriptData.guion, myRoles, sharedScript?.songs ?? []);
      }

      return selectedScenes;
    },
    [displayScriptData, myRoles, selectedScenes, sharedScript?.songs]
  );

  const sortScenesByScriptOrder = useCallback(
    (sceneTitles: string[]) => currentSceneTitles.filter((sceneTitle) => sceneTitles.includes(sceneTitle)),
    [currentSceneTitles]
  );

  const launchRehearsal = useCallback(
    (mode: RehearsalMode, lineIndex: number) => {
      const scenesToRehearse = getScenesForMode(mode);
      if (!displayScriptData || scenesToRehearse.length === 0) {
        return;
      }

      const totalLines = filterScriptByScenes(displayScriptData.guion, scenesToRehearse).length;
      const safeLineIndex = Math.max(0, Math.min(lineIndex, totalLines));
      const nextCheckpoint: RehearsalCheckpoint | null =
        safeLineIndex > 0
          ? {
              sceneFilter: scenesToRehearse,
              lineIndex: safeLineIndex,
              updatedAt: new Date().toISOString(),
            }
          : null;

      setActiveRehearsalMode(mode);
      setActiveRehearsalScenes(scenesToRehearse);
      setRehearsalStartIndex(safeLineIndex);
      setRehearsalCheckpoints((previousCheckpoints) => ({
        ...previousCheckpoints,
        [mode]: nextCheckpoint,
      }));
      setLastRehearsalMode(mode);
      setPendingResumeMode(null);
      setIsRehearsing(true);
    },
    [displayScriptData, getScenesForMode]
  );

  const requestRehearsalStart = useCallback(
    (mode: RehearsalMode) => {
      const scenesToRehearse = getScenesForMode(mode);
      if (!displayScriptData || scenesToRehearse.length === 0) {
        return;
      }

      const checkpoint = getApplicableCheckpoint(mode, scenesToRehearse);
      if (checkpoint) {
        setPendingResumeMode(mode);
        return;
      }

      launchRehearsal(mode, 0);
    },
    [displayScriptData, getApplicableCheckpoint, getScenesForMode, launchRehearsal]
  );

  const resetSelectionState = () => {
    setMyRoles([]);
    setSelectedScenes([]);
    setActiveRehearsalScenes([]);
    setActiveRehearsalMode(null);
    setRehearsalStartIndex(0);
    setLastRehearsalMode(null);
    setRehearsalCheckpoints(createEmptyRehearsalCheckpoints());
    setIsRehearsing(false);
    setMergeSource(null);
    setMergeTarget(null);
    setIsRolePanelVisible(false);
    setIsScenePanelVisible(false);
    setIsMergePanelVisible(false);
    setIsManagingSongs(false);
    setPendingResumeMode(null);
    setSharedScript(null);
    setSharedStatusText('');
    setSharedError(null);
    setIsHydratingSharedMergeMap(false);
  };

  const handleResetScript = () => {
    resetSelectionState();
    setCurrentScriptFileName(null);
    replaceSharedScriptIdInUrl(null);
    resetScript();
  };

  const handleSharedScriptManifestUpdate = useCallback((manifest: SharedScriptManifest) => {
    const normalizedManifest = {
      ...manifest,
      songs: syncSharedSongsWithScript(manifest.scriptData.guion, manifest.songs),
      musicalNumbers: syncSharedMusicalNumbersWithScript(
        syncSharedSongsWithScript(manifest.scriptData.guion, manifest.songs),
        manifest.musicalNumbers
      ),
    };

    setSharedScript(normalizedManifest);
    setSelectedSharedScriptId(normalizedManifest.shareId);
    setSharedScriptsCatalog((previousScripts) =>
      upsertSharedScriptSummary(previousScripts, buildSharedScriptSummaryFromManifest(normalizedManifest))
    );
  }, []);

  const loadRemoteSharedScript = useCallback(async (
    shareId: string,
    savedConfig?: SavedScriptConfig | null
  ) => {
    setIsLoadingSharedScript(true);
    setSharedError(null);
    setSharedStatusText('Cargando obra compartida...');

    try {
      const remoteManifest = await fetchSharedScript(shareId);
      const manifest = {
        ...remoteManifest,
        songs: syncSharedSongsWithScript(remoteManifest.scriptData.guion, remoteManifest.songs),
        musicalNumbers: syncSharedMusicalNumbersWithScript(
          syncSharedSongsWithScript(remoteManifest.scriptData.guion, remoteManifest.songs),
          remoteManifest.musicalNumbers
        ),
      };
      const localSnapshotConfig =
        sharedScript?.shareId === shareId && scriptData
          ? {
              myRoles,
              selectedScenes,
              lastRehearsalMode,
              rehearsalCheckpoints,
              sharedScriptId: shareId,
            }
          : null;
      const persistedConfig =
        savedScripts.find((savedScript) => savedScript.config.sharedScriptId === shareId)?.config ??
        savedScripts.find(
          (savedScript) => savedScript.scriptId === getScriptIdentity(manifest.scriptData)
        )?.config ??
        null;
      const resolvedSavedConfig = savedConfig
        ? cloneSavedScriptConfig(savedConfig)
        : localSnapshotConfig
          ? cloneSavedScriptConfig(localSnapshotConfig)
          : persistedConfig
            ? cloneSavedScriptConfig(persistedConfig)
            : null;

      resetSelectionState();
      setIsHydratingSharedMergeMap(true);
      setCurrentScriptFileName(manifest.fileName);
      setSharedScript(manifest);
      setSelectedSharedScriptId(manifest.shareId);
      setSharedStatusText('');
      setSharedError(null);
      replaceSharedScriptIdInUrl(manifest.shareId);
      if (resolvedSavedConfig) {
        setMyRoles(resolvedSavedConfig.myRoles);
        setSelectedScenes(resolvedSavedConfig.selectedScenes);
        setLastRehearsalMode(resolvedSavedConfig.lastRehearsalMode);
        setRehearsalCheckpoints(resolvedSavedConfig.rehearsalCheckpoints);
      }
      loadSavedScript(manifest.scriptData);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'No se pudo abrir la obra compartida.';
      setSharedError(`Error compartiendo: ${message}`);
      setSharedStatusText('');
    } finally {
      setIsLoadingSharedScript(false);
    }
  }, [
    lastRehearsalMode,
    loadSavedScript,
    myRoles,
    rehearsalCheckpoints,
    savedScripts,
    scriptData,
    selectedScenes,
    sharedScript?.shareId,
  ]);

  const handlePublishSharedScript = useCallback(async () => {
    if (!scriptData) {
      return;
    }

    setIsSharingScript(true);
    setSharedError(null);
    setSharedStatusText(sharedScript ? 'Actualizando obra compartida...' : 'Publicando obra compartida...');

    try {
      const freshestSharedScript =
        sharedScript?.shareId
          ? await fetchSharedScript(sharedScript.shareId).catch(() => sharedScript)
          : null;
      const baseSharedSongs = syncSharedSongsWithScript(
        scriptData.guion,
        freshestSharedScript?.songs ?? sharedScript?.songs
      );

      const response = await publishSharedScript({
        shareId: sharedScript?.shareId ?? null,
        fileName: currentScriptFileName ?? scriptData.obra,
        scriptData,
        mergeMap,
        songs: baseSharedSongs,
        musicalNumbers: syncSharedMusicalNumbersWithScript(
          baseSharedSongs,
          freshestSharedScript?.musicalNumbers ?? sharedScript?.musicalNumbers
        ),
      });

      const manifest = {
        ...response.manifest,
        songs: syncSharedSongsWithScript(response.manifest.scriptData.guion, response.manifest.songs),
        musicalNumbers: syncSharedMusicalNumbersWithScript(
          syncSharedSongsWithScript(response.manifest.scriptData.guion, response.manifest.songs),
          response.manifest.musicalNumbers
        ),
      };

      setSharedScript(manifest);
      setSelectedSharedScriptId(manifest.shareId);
      setSharedScriptsCatalog((previousScripts) =>
        upsertSharedScriptSummary(previousScripts, buildSharedScriptSummaryFromManifest(manifest))
      );
      setSharedStatusText('Obra compartida lista para enviar.');
      setIsHydratingSharedMergeMap(false);
      replaceSharedScriptIdInUrl(manifest.shareId);
    } catch (publishError) {
      const message = publishError instanceof Error ? publishError.message : 'No se pudo publicar la obra.';
      setSharedError(`Error compartiendo: ${message}`);
      setSharedStatusText('');
    } finally {
      setIsSharingScript(false);
    }
  }, [currentScriptFileName, mergeMap, scriptData, sharedScript]);

  const handleMergeCharacters = () => {
    if (!mergeSource || !mergeTarget) {
      return;
    }

    mergeCharacter(mergeSource, mergeTarget);
    setMergeSource(null);
    setMergeTarget(null);
  };

  const handleOpenSavedScript = async (savedScript: SavedScript) => {
    if (savedScript.config.sharedScriptId) {
      await loadRemoteSharedScript(savedScript.config.sharedScriptId, savedScript.config);
      return;
    }

    setCurrentScriptFileName(savedScript.fileName);
    setMyRoles(savedScript.config.myRoles);
    setSelectedScenes(savedScript.config.selectedScenes);
    setLastRehearsalMode(savedScript.config.lastRehearsalMode);
    setRehearsalCheckpoints(savedScript.config.rehearsalCheckpoints);
    setActiveRehearsalScenes([]);
    setActiveRehearsalMode(null);
    setRehearsalStartIndex(0);
    setIsRehearsing(false);
    setMergeSource(null);
    setMergeTarget(null);
    setIsRolePanelVisible(false);
    setIsScenePanelVisible(false);
    setIsMergePanelVisible(false);
    setPendingResumeMode(null);
    setSharedScript(null);
    setSharedStatusText('');
    setSharedError(null);
    replaceSharedScriptIdInUrl(null);
    loadSavedScript(savedScript.data);
  };

  const refreshSharedScriptsCatalog = useCallback(async () => {
    setIsLoadingSharedScriptsCatalog(true);
    setSharedScriptsCatalogError(null);

    try {
      const scripts = await fetchSharedScriptList();
      setSharedScriptsCatalog(scripts);
      setSelectedSharedScriptId((previousSelectedId) => {
        if (previousSelectedId && scripts.some((script) => script.shareId === previousSelectedId)) {
          return previousSelectedId;
        }

        if (sharedScript && scripts.some((script) => script.shareId === sharedScript.shareId)) {
          return sharedScript.shareId;
        }

        return scripts[0]?.shareId ?? null;
      });
    } catch (catalogError) {
      const message =
        catalogError instanceof Error
          ? catalogError.message
          : 'No se pudieron cargar las obras compartidas.';
      setSharedScriptsCatalogError(message);
    } finally {
      setIsLoadingSharedScriptsCatalog(false);
    }
  }, [sharedScript]);

  useEffect(() => {
    void refreshSharedScriptsCatalog();
  }, [refreshSharedScriptsCatalog]);

  useEffect(() => {
    if (scriptData || loading || isLoadingSharedScript || isSharingScript) {
      return;
    }

    const shareId = getSharedScriptIdFromUrl();
    if (!shareId) {
      return;
    }

    void loadRemoteSharedScript(shareId);
  }, [isLoadingSharedScript, isSharingScript, loadRemoteSharedScript, loading, scriptData]);

  useEffect(() => {
    if (!sharedScript || !isHydratingSharedMergeMap) {
      return;
    }

    if (areMergeMapsEqual(sharedScript.mergeMap, mergeMap)) {
      setIsHydratingSharedMergeMap(false);
    }
  }, [isHydratingSharedMergeMap, mergeMap, sharedScript]);

  useEffect(() => {
    if (!sharedScript || !scriptData || !areRoleMergesReady || isSharingScript || isHydratingSharedMergeMap) {
      return;
    }

    if (areMergeMapsEqual(sharedScript.mergeMap, mergeMap)) {
      return;
    }

    void handlePublishSharedScript();
  }, [areRoleMergesReady, handlePublishSharedScript, isHydratingSharedMergeMap, isSharingScript, mergeMap, scriptData, sharedScript]);

  const handleRehearsalProgressChange = useCallback(
    (lineIndex: number, totalLines: number) => {
      if (!activeRehearsalMode || activeRehearsalScenes.length === 0) {
        return;
      }

      if (lineIndex >= totalLines) {
        setRehearsalCheckpoints((previousCheckpoints) => ({
          ...previousCheckpoints,
          [activeRehearsalMode]: null,
        }));
        return;
      }

      setRehearsalCheckpoints((previousCheckpoints) => ({
        ...previousCheckpoints,
        [activeRehearsalMode]: {
          sceneFilter: activeRehearsalScenes,
          lineIndex,
          updatedAt: new Date().toISOString(),
        },
      }));
    },
    [activeRehearsalMode, activeRehearsalScenes]
  );

  const toggleSelectedScene = useCallback(
    (sceneTitle: string) => {
      setSelectedScenes((previousScenes) => {
        const nextScenes = previousScenes.includes(sceneTitle)
          ? previousScenes.filter((currentScene) => currentScene !== sceneTitle)
          : [...previousScenes, sceneTitle];

        return sortScenesByScriptOrder(nextScenes);
      });
    },
    [sortScenesByScriptOrder]
  );

  const resumeSceneNumber = pendingJob
    ? Math.min(pendingJob.index + 2, pendingJob.totalChunks.length)
    : null;

  const selectedRolesSummary =
    myRoles.length > 0 ? myRoles.join(', ') : 'Todavia no has elegido personaje';

  const renderResumeChoiceForMode = (mode: RehearsalMode) => {
    if (
      pendingResumeMode !== mode ||
      !pendingResumeCheckpoint ||
      pendingResumeScenes.length === 0
    ) {
      return null;
    }

    return (
      <View style={styles.resumeChoiceCard}>
        <Text style={styles.resumeChoiceTitle}>Hay un ensayo a medias guardado</Text>
        <Text style={styles.resumeChoiceText}>
          Puedes retomar desde la linea {Math.min(pendingResumeCheckpoint.lineIndex, pendingResumeTotalLines)}
          {' '}de {pendingResumeTotalLines}.
        </Text>
        <View style={styles.resumeChoiceActions}>
          <TouchableOpacity
            style={[styles.resumeChoiceButton, styles.resumeChoicePrimary]}
            onPress={() =>
              launchRehearsal(
                pendingResumeMode,
                Math.min(pendingResumeCheckpoint.lineIndex, pendingResumeTotalLines)
              )
            }
          >
            <Text style={styles.resumeChoicePrimaryText}>Retomar donde lo deje</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.resumeChoiceButton, styles.resumeChoiceSecondary]}
            onPress={() => launchRehearsal(pendingResumeMode, 0)}
          >
            <Text style={styles.resumeChoiceSecondaryText}>Empezar desde 0</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (isRehearsing && displayScriptData) {
    return (
      <ScreenWrapper>
        <RehearsalView
          guion={displayScriptData.guion}
          myRoles={myRoles}
          filterScenes={activeRehearsalScenes}
          sharedSongs={sharedScript?.songs ?? []}
          musicalNumbers={sharedScript?.musicalNumbers ?? []}
          initialIndex={rehearsalStartIndex}
          onProgressChange={handleRehearsalProgressChange}
          onExit={() => setIsRehearsing(false)}
        />
      </ScreenWrapper>
    );
  }

  if (isManagingSongs && displayScriptData) {
    return (
      <ScreenWrapper>
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.titlePanel}>
            <Text style={styles.title}>AI-Theatre</Text>
          </View>

          <View style={styles.scriptTitlePanel}>
            <Text style={styles.status}>Gestion de canciones</Text>
            <Text style={styles.obraTitle}>{displayScriptData.obra}</Text>
          </View>

          {effectiveError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{effectiveError}</Text>
            </View>
          )}

          <View style={styles.songManagerScreen}>
            <SongManagerPanel
              sharedScript={sharedScript}
              availableRoles={displayScriptData.personajes}
              myRoles={myRoles}
              onManifestUpdated={handleSharedScriptManifestUpdate}
              standalone
            />
          </View>

          <TouchableOpacity onPress={() => setIsManagingSongs(false)} style={styles.btnBack}>
            <Text style={styles.btnBackText}>Volver a la obra</Text>
          </TouchableOpacity>
        </ScrollView>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.titlePanel}>
          <Text style={styles.title}>AI-Theatre</Text>
        </View>

        {effectiveError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{effectiveError}</Text>
          </View>
        )}

        {pendingJob && !effectiveLoading && !scriptData && (
          <View style={styles.resumeBox}>
            <Text style={styles.resumeTitle}>Guion incompleto detectado</Text>
            <TouchableOpacity style={styles.btnResume} onPress={() => void resumePendingJob()}>
              <Text style={styles.btnText}>
                Retomar {resumeSceneNumber ? `(Escena ${resumeSceneNumber})` : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.discardButton} onPress={() => void discardPendingJob()}>
              <Text style={styles.discardText}>Descartar</Text>
            </TouchableOpacity>
          </View>
        )}

        {effectiveLoading || displayScriptData ? (
          <View style={styles.section}>
            <View style={styles.scriptTitlePanel}>
              {effectiveLoading && progressText ? <Text style={styles.status}>{progressText}</Text> : null}
              <Text style={styles.obraTitle}>
                {displayScriptData?.obra ?? currentScriptFileName ?? 'Analizando guion...'}
              </Text>
            </View>

            <View style={styles.actionStack}>
              <View style={styles.roleWrapper}>
                <TouchableOpacity
                  style={[styles.btnMenu, styles.roleToggleButton]}
                  onPress={() => setIsRolePanelVisible((previousValue) => !previousValue)}
                >
                  <View style={styles.menuButtonContent}>
                    <MaterialCommunityIcons name="account-star-outline" size={22} color="#fff" />
                    <Text style={styles.btnText}>
                      {isRolePanelVisible ? 'Ocultar seleccion de personajes' : 'Seleccion de personajes'}
                      {myRoles.length > 0 ? ` (${myRoles.length})` : ''}
                    </Text>
                  </View>
                </TouchableOpacity>
                <Text style={styles.selectionPreview}>{selectedRolesSummary}</Text>

                {isRolePanelVisible ? (
                  <View style={styles.rolePanel}>
                    <Text style={styles.label}>Personajes detectados (elige el tuyo):</Text>
                    <View style={styles.tags}>
                      {displayScriptData?.personajes.map((character) => (
                        <TouchableOpacity
                          key={character}
                          style={[styles.tag, myRoles.includes(character) && styles.tagSelected]}
                          onPress={() =>
                            setMyRoles((previousRoles) =>
                              previousRoles.includes(character)
                                ? previousRoles.filter((role) => role !== character)
                                : [...previousRoles, character]
                            )
                          }
                        >
                          <Text style={[styles.tagText, myRoles.includes(character) && styles.tagTextSelected]}>
                            {myRoles.includes(character) ? `OK ${character}` : character}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>

              <View style={styles.sceneWrapper}>
                <TouchableOpacity
                  style={[styles.btnMenu, styles.sceneToggleButton]}
                  onPress={() => setIsScenePanelVisible((previousValue) => !previousValue)}
                >
                  <View style={styles.menuButtonContent}>
                    <MaterialCommunityIcons name="movie-open-play-outline" size={22} color="#fff" />
                    <Text style={styles.btnText}>
                      {isScenePanelVisible ? 'Ocultar seleccion de escenas' : 'Seleccion de escenas'}
                      {selectedScenes.length > 0 ? ` (${selectedScenes.length})` : ''}
                    </Text>
                  </View>
                </TouchableOpacity>
                <Text style={styles.selectionPreview}>{selectedScenesSummary}</Text>

                {isScenePanelVisible ? (
                  <View style={styles.scenePanel}>
                    <Text style={styles.label}>Marca las escenas que quieres ensayar aparte:</Text>
                    <View style={styles.sceneActions}>
                      <TouchableOpacity
                        style={styles.sceneActionButton}
                        onPress={() => setSelectedScenes(currentSceneTitles)}
                      >
                        <Text style={styles.sceneActionText}>Seleccionar todas</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.sceneActionButton}
                        onPress={() => setSelectedScenes([])}
                      >
                        <Text style={styles.sceneActionText}>Quitar todas</Text>
                      </TouchableOpacity>
                    </View>
                    <View style={styles.tags}>
                      {currentSceneTitles.map((sceneTitle) => (
                        <TouchableOpacity
                          key={sceneTitle}
                          style={[styles.tag, selectedScenes.includes(sceneTitle) && styles.tagSelected]}
                          onPress={() => toggleSelectedScene(sceneTitle)}
                        >
                          <Text style={[styles.tagText, selectedScenes.includes(sceneTitle) && styles.tagTextSelected]}>
                            {sceneTitle}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>

              <View style={styles.menu}>
                <View style={styles.menuOption}>
                  <TouchableOpacity
                    style={[styles.btnMenu, styles.songLaunchButton, !sharedScript && styles.buttonDisabled]}
                    onPress={() => setIsManagingSongs(true)}
                    disabled={!sharedScript}
                  >
                    <View style={styles.songLaunchContent}>
                      <MaterialCommunityIcons name="music-clef-treble" size={22} color="#fff7dc" />
                      <Text style={styles.btnText}>Canciones</Text>
                    </View>
                    {sharedScript ? (
                      <View style={styles.songLaunchBadge}>
                        <Text style={styles.songLaunchBadgeText}>{sharedScript.songs.length}</Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                </View>
                <View style={styles.menuOption}>
                  <TouchableOpacity
                    style={[styles.btnMenu, myRoles.length === 0 && styles.buttonDisabled]}
                    onPress={() => requestRehearsalStart('ALL')}
                    disabled={myRoles.length === 0}
                  >
                    <View style={styles.menuButtonContent}>
                      <MaterialCommunityIcons name="theater" size={22} color="#fff" />
                      <Text style={styles.btnText}>Ensayar obra completa</Text>
                    </View>
                  </TouchableOpacity>
                  {renderResumeChoiceForMode('ALL')}
                </View>
                <View style={styles.menuOption}>
                  <TouchableOpacity
                    style={[styles.btnMenu, styles.btnSecondary, myRoles.length === 0 && styles.buttonDisabled]}
                    onPress={() => requestRehearsalStart('MINE')}
                    disabled={myRoles.length === 0}
                  >
                    <View style={styles.menuButtonContent}>
                      <MaterialCommunityIcons name="account-voice" size={22} color="#fff" />
                      <Text style={styles.btnText}>Ensayar mis escenas</Text>
                    </View>
                  </TouchableOpacity>
                  {renderResumeChoiceForMode('MINE')}
                </View>
                <View style={styles.menuOption}>
                  <TouchableOpacity
                    style={[styles.btnMenu, styles.btnTertiary, selectedScenes.length === 0 && styles.buttonDisabled]}
                    onPress={() => requestRehearsalStart('SELECTED')}
                    disabled={selectedScenes.length === 0}
                  >
                    <View style={styles.menuButtonContent}>
                      <MaterialCommunityIcons name="playlist-play" size={22} color="#fff" />
                      <Text style={styles.btnText}>Ensayar escenas seleccionadas</Text>
                    </View>
                  </TouchableOpacity>
                  {renderResumeChoiceForMode('SELECTED')}
                </View>
              </View>

              {!loading && scriptData && (
                <View style={styles.mergeWrapper}>
                  <TouchableOpacity
                    style={[styles.btnMenu, styles.mergeToggleButton]}
                    onPress={() => setIsMergePanelVisible((previousValue) => !previousValue)}
                  >
                    <View style={styles.menuButtonContent}>
                      <MaterialCommunityIcons name="account-group-outline" size={22} color="#fff" />
                      <Text style={styles.btnText}>
                        {isMergePanelVisible ? 'Ocultar fusion de personajes' : 'Fusion de personajes'}
                        {mergeEntries.length > 0 ? ` (${mergeEntries.length})` : ''}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {isMergePanelVisible ? (
                    <View style={styles.mergePanel}>
                      <Text style={styles.mergeTitle}>Fusionar personajes duplicados</Text>
                      <Text style={styles.mergeHint}>
                        {sharedScript
                          ? 'Une alias o variantes del mismo personaje. Esta fusion se compartira con quien abra esta obra.'
                          : 'Une alias o variantes del mismo personaje. Se guardara solo para esta obra.'}
                      </Text>

                      {!areRoleMergesReady ? (
                        <Text style={styles.mergeLoading}>Cargando fusiones guardadas...</Text>
                      ) : (
                        <>
                          <Text style={styles.mergeStep}>1. Elige el nombre a corregir</Text>
                          <View style={styles.tags}>
                            {mergeSourceCandidates.map((character) => (
                              <TouchableOpacity
                                key={`source-${character}`}
                                style={[styles.tag, mergeSource === character && styles.tagSelected]}
                                onPress={() => {
                                  setMergeSource(character);
                                  setMergeTarget(null);
                                }}
                              >
                                <Text style={[styles.tagText, mergeSource === character && styles.tagTextSelected]}>
                                  {character}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>

                          {mergeSource ? (
                            <>
                              <Text style={styles.mergeStep}>2. Elige el personaje correcto</Text>
                              <View style={styles.tags}>
                                {mergeTargetCandidates.map((character) => (
                                  <TouchableOpacity
                                    key={`target-${character}`}
                                    style={[styles.tag, mergeTarget === character && styles.tagSelected]}
                                    onPress={() => setMergeTarget(character)}
                                  >
                                    <Text style={[styles.tagText, mergeTarget === character && styles.tagTextSelected]}>
                                      {character}
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </View>

                              <TouchableOpacity
                                style={[styles.btnMenu, styles.mergeAction, !mergeTarget && styles.buttonDisabled]}
                                onPress={handleMergeCharacters}
                                disabled={!mergeTarget}
                              >
                                <Text style={styles.btnText}>Fusionar {mergeSource} en {mergeTarget ?? '...'}</Text>
                              </TouchableOpacity>
                            </>
                          ) : null}

                          {mergeEntries.length > 0 ? (
                            <>
                              <Text style={styles.mergeStep}>Fusiones activas</Text>
                              <View style={styles.mergeList}>
                                {mergeEntries.map(({ sourceCharacter, targetCharacter }) => (
                                  <TouchableOpacity
                                    key={`${sourceCharacter}-${targetCharacter}`}
                                    style={styles.mergeChip}
                                    onPress={() => removeMerge(sourceCharacter)}
                                  >
                                    <Text style={styles.mergeChipText}>
                                      {sourceCharacter}
                                      {' -> '}
                                      {targetCharacter}
                                      {' · quitar'}
                                    </Text>
                                  </TouchableOpacity>
                                ))}
                              </View>
                              <TouchableOpacity onPress={clearMerges} style={styles.clearMergeButton}>
                                <Text style={styles.clearMergeText}>Quitar todas las fusiones</Text>
                              </TouchableOpacity>
                            </>
                          ) : null}
                        </>
                      )}
                    </View>
                  ) : null}
                </View>
              )}
            </View>

            {!!displayScriptData && !effectiveLoading ? (
              <View style={styles.shareActions}>
                <TouchableOpacity
                  style={[styles.compactShareButton, sharedScript && styles.compactShareButtonActive]}
                  onPress={() => void handlePublishSharedScript()}
                  disabled={isSharingScript}
                >
                  <Text style={[styles.compactShareButtonText, sharedScript && styles.compactShareButtonTextActive]}>
                    {sharedScript ? 'Actualizar obra compartida' : 'Compartir obra'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {!effectiveLoading && (
              <TouchableOpacity onPress={handleResetScript} style={styles.btnBack}>
                <Text style={styles.btnBackText}>Cambiar guion</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.homeContent}>
            <View style={styles.sharedLibrarySection}>
              <TouchableOpacity
                style={styles.collapsibleSectionHeader}
                onPress={() => setIsSavedScriptsPanelVisible((previousValue) => !previousValue)}
              >
                <View>
                  <Text style={styles.libraryTitle}>
                    Obras en curso {savedScripts.length > 0 ? `(${savedScripts.length})` : ''}
                  </Text>
                  <Text style={styles.libraryHint}>
                    {isSavedScriptsPanelVisible ? 'Ocultar obras en curso' : 'Mostrar obras en curso'}
                  </Text>
                </View>
                <Text style={styles.collapsibleIndicator}>{isSavedScriptsPanelVisible ? '−' : '+'}</Text>
              </TouchableOpacity>

              {isSavedScriptsPanelVisible ? (
                savedScripts.length > 0 ? (
                  <View style={styles.libraryList}>
                    {savedScripts.map((savedScript) => (
                      <View key={savedScript.id} style={styles.libraryCard}>
                        <View style={styles.libraryCardBody}>
                          <Text style={styles.libraryCardTitle}>{savedScript.data.obra}</Text>
                          <Text style={styles.libraryCardMeta}>{savedScript.fileName}</Text>
                          <Text style={styles.libraryCardMeta}>
                            {savedScript.config.myRoles.length > 0
                              ? `${savedScript.config.myRoles.length} personaje${savedScript.config.myRoles.length === 1 ? '' : 's'} seleccionado${savedScript.config.myRoles.length === 1 ? '' : 's'}`
                              : 'Sin personaje elegido todavia'}
                          </Text>
                          {savedScript.config.sharedScriptId ? (
                            <Text style={styles.libraryCardMeta}>Obra compartida disponible</Text>
                          ) : null}
                        </View>

                        <View style={styles.libraryActions}>
                          <TouchableOpacity
                            style={[styles.libraryButton, styles.libraryOpenButton]}
                            onPress={() => void handleOpenSavedScript(savedScript)}
                          >
                            <Text style={styles.libraryButtonText}>Abrir</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.libraryButton, styles.libraryDeleteButton]}
                            onPress={() => void deleteScript(savedScript.id)}
                          >
                            <Text style={styles.libraryDeleteText}>Borrar</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.sharedInfoText}>Todavia no hay obras en curso guardadas.</Text>
                )
              ) : null}
            </View>

            <View style={styles.sharedLibrarySection}>
              <TouchableOpacity
                style={styles.collapsibleSectionHeader}
                onPress={() => setIsSharedScriptsPanelVisible((previousValue) => !previousValue)}
              >
                <View style={styles.sharedSectionHeading}>
                  <Text style={styles.libraryTitle}>
                    Obras compartidas {sharedScriptsCatalog.length > 0 ? `(${sharedScriptsCatalog.length})` : ''}
                  </Text>
                  <Text style={styles.libraryHint}>
                    {isSharedScriptsPanelVisible ? 'Ocultar obras compartidas' : 'Mostrar obras compartidas'}
                  </Text>
                </View>
                <View style={styles.sharedHeaderActions}>
                  <TouchableOpacity
                    style={styles.sharedRefreshButton}
                    onPress={() => void refreshSharedScriptsCatalog()}
                    disabled={isLoadingSharedScriptsCatalog}
                  >
                    <Text style={styles.sharedRefreshButtonText}>
                      {isLoadingSharedScriptsCatalog ? '...' : 'Actualizar'}
                    </Text>
                  </TouchableOpacity>
                  <Text style={styles.collapsibleIndicator}>{isSharedScriptsPanelVisible ? '−' : '+'}</Text>
                </View>
              </TouchableOpacity>

              {isSharedScriptsPanelVisible ? (
                <>
                  {sharedScriptsCatalogError ? (
                    <Text style={styles.sharedInfoText}>
                      No se pudieron cargar las obras compartidas: {sharedScriptsCatalogError}
                    </Text>
                  ) : null}

                  {isLoadingSharedScriptsCatalog && sharedScriptsCatalog.length === 0 ? (
                    <Text style={styles.sharedInfoText}>Cargando obras compartidas...</Text>
                  ) : null}

                  {!isLoadingSharedScriptsCatalog && sharedScriptsCatalog.length === 0 && !sharedScriptsCatalogError ? (
                    <Text style={styles.sharedInfoText}>
                      Todavia no hay obras compartidas. Publica una y el resto la vera aqui.
                    </Text>
                  ) : null}

                  {sharedScriptsCatalog.length > 0 ? (
                    <View style={styles.libraryList}>
                      {sharedScriptsCatalog.map((sharedCatalogItem) => {
                        const isSelected = selectedSharedScriptSummary?.shareId === sharedCatalogItem.shareId;

                        return (
                          <TouchableOpacity
                            key={sharedCatalogItem.shareId}
                            style={[styles.sharedScriptListItem, isSelected && styles.sharedScriptListItemSelected]}
                            onPress={() => setSelectedSharedScriptId(sharedCatalogItem.shareId)}
                          >
                            <View style={styles.sharedScriptListText}>
                              <Text
                                style={[
                                  styles.sharedScriptListTitle,
                                  isSelected && styles.sharedScriptListTitleSelected,
                                ]}
                              >
                                {sharedCatalogItem.obra}
                              </Text>
                              <Text style={styles.sharedScriptListDate}>
                                {formatSharedScriptTimestamp(sharedCatalogItem.updatedAt)}
                              </Text>
                            </View>
                            {sharedScript?.shareId === sharedCatalogItem.shareId ? (
                              <View style={styles.sharedActiveBadge}>
                                <Text style={styles.sharedActiveBadgeText}>Abierta</Text>
                              </View>
                            ) : null}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : null}

                  {selectedSharedScriptSummary ? (
                    <View style={styles.sharedScriptCard}>
                      <View style={styles.libraryCardBody}>
                        <View style={styles.sharedScriptTitleRow}>
                          <Text style={styles.libraryCardTitle}>{selectedSharedScriptSummary.obra}</Text>
                          {sharedScript?.shareId === selectedSharedScriptSummary.shareId ? (
                            <View style={styles.sharedActiveBadge}>
                              <Text style={styles.sharedActiveBadgeText}>Abierta</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.libraryCardMeta}>{selectedSharedScriptSummary.fileName}</Text>
                        <Text style={styles.libraryCardMeta}>
                          {selectedSharedScriptSummary.mergeCount > 0
                            ? `${selectedSharedScriptSummary.mergeCount} fusion${selectedSharedScriptSummary.mergeCount === 1 ? '' : 'es'} compartida${selectedSharedScriptSummary.mergeCount === 1 ? '' : 's'}`
                            : 'Sin fusiones compartidas todavia'}
                        </Text>
                        <Text style={styles.libraryCardMeta}>
                          {selectedSharedScriptSummary.songCount > 0
                            ? `${selectedSharedScriptSummary.songCount} bloque${selectedSharedScriptSummary.songCount === 1 ? '' : 's'} de cancion preparado${selectedSharedScriptSummary.songCount === 1 ? '' : 's'}`
                            : 'Sin bloques de cancion registrados'}
                        </Text>
                        <Text style={styles.libraryCardMeta}>
                          {formatSharedScriptTimestamp(selectedSharedScriptSummary.updatedAt)}
                        </Text>
                      </View>

                      <View style={styles.libraryActions}>
                        <TouchableOpacity
                          style={[styles.libraryButton, styles.libraryOpenButton]}
                          onPress={() => void loadRemoteSharedScript(selectedSharedScriptSummary.shareId)}
                        >
                          <Text style={styles.libraryButtonText}>Abrir</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>

            <View style={styles.homeActions}>
              <TouchableOpacity
                style={styles.btnMain}
                onPress={async () => {
                  const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
                  if (!result.canceled) {
                    resetSelectionState();
                    replaceSharedScriptIdInUrl(null);
                    setCurrentScriptFileName(result.assets[0].name ?? null);
                    await analyzeInStages(result.assets[0].uri, undefined, result.assets[0].name);
                  }
                }}
              >
                <Text style={styles.btnText}>Cargar PDF</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        <VersionBadge />
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20, alignItems: 'center' },
  titlePanel: {
    alignSelf: 'center',
    marginBottom: 20,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(240, 245, 250, 0.82)',
    shadowColor: '#10263d',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 3,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#17324c',
    textAlign: 'center',
    textShadowColor: 'rgba(255,255,255,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  errorBox: { backgroundColor: '#ffebee', padding: 15, borderRadius: 8, marginBottom: 20, width: '100%' },
  errorText: {
    color: '#c62828',
    textAlign: 'left',
    fontWeight: '600',
    fontSize: 12,
    lineHeight: 18,
  },
  resumeBox: {
    backgroundColor: 'rgba(232, 245, 233, 0.95)',
    padding: 20,
    borderRadius: 18,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#cde8d0',
  },
  resumeTitle: { fontWeight: 'bold', marginBottom: 10 },
  btnResume: {
    backgroundColor: 'rgba(76, 175, 80, 0.82)',
    padding: 12,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  discardButton: { marginTop: 10 },
  discardText: { color: '#c62828', fontWeight: '600' },
  homeContent: { width: '100%', gap: 24 },
  homeActions: { gap: 12, width: '100%' },
  section: { width: '100%' },
  scriptTitlePanel: {
    marginBottom: 20,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(220, 233, 247, 0.9)',
    shadowColor: '#17324c',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 2,
  },
  status: { color: '#1e6091', textAlign: 'center', marginBottom: 8, fontWeight: 'bold' },
  obraTitle: { fontSize: 24, fontWeight: '800', textAlign: 'center', color: '#17324c' },
  actionStack: { gap: 14 },
  shareActions: { gap: 10 },
  compactShareButton: {
    marginTop: 18,
    alignSelf: 'center',
    minWidth: 220,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: 'rgba(24, 78, 119, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(24, 78, 119, 0.95)',
  },
  compactShareButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderColor: 'rgba(199, 214, 232, 0.94)',
  },
  compactShareButtonText: {
    fontWeight: '700',
    color: '#fff',
  },
  compactShareButtonTextActive: {
    color: '#184e77',
  },
  songManagerScreen: {
    width: '100%',
  },
  roleWrapper: { gap: 10 },
  roleToggleButton: { backgroundColor: 'rgba(24, 78, 119, 0.82)' },
  sceneWrapper: { gap: 10 },
  sceneToggleButton: { backgroundColor: 'rgba(91, 63, 140, 0.82)' },
  selectionPreview: {
    textAlign: 'center',
    color: '#27435d',
    lineHeight: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(222, 233, 244, 0.88)',
  },
  rolePanel: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: '#dbe8f5',
  },
  scenePanel: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: '#ddd4f5',
  },
  sceneActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  sceneActionButton: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(237, 231, 251, 0.82)',
  },
  sceneActionText: { color: '#5b3f8c', fontWeight: '700' },
  label: { color: '#4f6274', marginBottom: 10, textAlign: 'center', fontWeight: '600' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 8 },
  mergeWrapper: { gap: 12 },
  mergeToggleButton: { backgroundColor: 'rgba(124, 77, 45, 0.82)' },
  mergePanel: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: '#eadcc8',
  },
  mergeTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 8, color: '#432818' },
  mergeHint: { color: '#6b5b49', textAlign: 'center', marginBottom: 16, lineHeight: 20 },
  mergeLoading: { textAlign: 'center', color: '#5f6b7a' },
  mergeStep: { fontWeight: '600', marginBottom: 10, textAlign: 'center', color: '#3b4147' },
  mergeAction: { marginTop: 4, marginBottom: 8, backgroundColor: 'rgba(156, 102, 68, 0.84)' },
  mergeList: { gap: 10 },
  mergeChip: {
    backgroundColor: '#fff4e8',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  mergeChipText: { color: '#7c4d2d', textAlign: 'center', fontWeight: '600' },
  clearMergeButton: { marginTop: 14, alignSelf: 'center' },
  clearMergeText: { color: '#c62828', fontWeight: '600' },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f0f7ff',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#d0e3ff',
  },
  tagSelected: { backgroundColor: '#e8f5e9', borderColor: '#a5d6a7' },
  tagText: { color: '#007AFF' },
  tagTextSelected: { color: '#1b5e20', fontWeight: '600' },
  menu: { gap: 12 },
  menuOption: { gap: 10 },
  songLaunchButton: {
    backgroundColor: 'rgba(165, 37, 88, 0.84)',
    borderColor: 'rgba(255, 231, 164, 0.44)',
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 18,
    position: 'relative',
  },
  songLaunchContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  songLaunchBadge: {
    position: 'absolute',
    right: 18,
    minWidth: 34,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 247, 220, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255, 243, 196, 0.42)',
    alignItems: 'center',
  },
  songLaunchBadgeText: {
    color: '#fff7dc',
    fontWeight: '800',
  },
  menuButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  btnMenu: {
    backgroundColor: 'rgba(0, 122, 255, 0.78)',
    padding: 18,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    shadowColor: '#0d1b2a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 3,
  },
  btnSecondary: { backgroundColor: 'rgba(43, 147, 72, 0.8)' },
  btnTertiary: { backgroundColor: 'rgba(91, 63, 140, 0.8)' },
  btnMain: {
    backgroundColor: 'rgba(0, 122, 255, 0.8)',
    padding: 20,
    borderRadius: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    shadowColor: '#0d1b2a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 3,
  },
  btnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
    textShadowColor: 'rgba(0,0,0,0.22)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  btnBack: { marginTop: 25, alignSelf: 'center' },
  btnBackText: { color: '#184e77', fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
  resumeChoiceCard: {
    padding: 18,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: '#d6ead8',
    gap: 12,
  },
  resumeChoiceTitle: {
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: '#204b2d',
  },
  resumeChoiceText: {
    textAlign: 'center',
    lineHeight: 20,
    color: '#47604f',
  },
  resumeChoiceActions: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  resumeChoiceButton: {
    flex: 1,
    minWidth: 180,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  resumeChoicePrimary: {
    backgroundColor: 'rgba(43, 147, 72, 0.84)',
    borderColor: 'rgba(43, 147, 72, 0.95)',
  },
  resumeChoiceSecondary: {
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderColor: '#c9d7cb',
  },
  resumeChoicePrimaryText: { color: '#fff', fontWeight: '700' },
  resumeChoiceSecondaryText: { color: '#47604f', fontWeight: '700' },
  librarySection: {
    width: '100%',
    padding: 18,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.84)',
    borderWidth: 1,
    borderColor: '#eceff3',
  },
  sharedLibrarySection: {
    width: '100%',
    padding: 18,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.84)',
    borderWidth: 1,
    borderColor: '#dbe9f6',
    gap: 16,
  },
  collapsibleSectionHeader: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  collapsibleIndicator: {
    fontSize: 28,
    lineHeight: 28,
    color: '#184e77',
    fontWeight: '500',
  },
  sharedSectionHeader: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  sharedHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sharedSectionHeading: {
    flex: 1,
  },
  sharedRefreshButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(24, 78, 119, 0.88)',
  },
  sharedRefreshButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  sharedInfoText: {
    textAlign: 'center',
    color: '#5f6b7a',
    lineHeight: 20,
  },
  libraryTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 6, color: '#1d2733' },
  libraryHint: { textAlign: 'center', color: '#5f6b7a', marginBottom: 18, lineHeight: 20 },
  libraryList: { gap: 14 },
  libraryCard: {
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: '#e4e8ee',
    padding: 16,
    gap: 14,
  },
  sharedScriptCard: {
    borderRadius: 16,
    backgroundColor: 'rgba(247, 251, 255, 0.94)',
    borderWidth: 1,
    borderColor: '#d7e6f5',
    padding: 16,
    gap: 14,
  },
  sharedScriptListItem: {
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: '#dbe6f2',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  sharedScriptListItemSelected: {
    backgroundColor: 'rgba(232, 243, 255, 0.96)',
    borderColor: '#8eb8e2',
  },
  sharedScriptListText: {
    flex: 1,
    gap: 4,
  },
  sharedScriptListTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1d2733',
  },
  sharedScriptListTitleSelected: {
    color: '#184e77',
  },
  sharedScriptListDate: {
    color: '#5f6b7a',
    lineHeight: 20,
  },
  libraryCardBody: { gap: 4 },
  sharedScriptTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sharedActiveBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(43, 147, 72, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(43, 147, 72, 0.28)',
  },
  sharedActiveBadgeText: {
    color: '#2b9348',
    fontWeight: '700',
    fontSize: 12,
  },
  libraryCardTitle: { fontSize: 17, fontWeight: '700', color: '#1d2733' },
  libraryCardMeta: { color: '#5f6b7a', lineHeight: 20 },
  libraryActions: { flexDirection: 'row', gap: 10 },
  libraryButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  libraryOpenButton: { backgroundColor: 'rgba(0, 122, 255, 0.82)', borderColor: 'rgba(0, 122, 255, 0.95)' },
  libraryDeleteButton: { backgroundColor: 'rgba(255, 245, 245, 0.86)', borderColor: '#f3c5c5' },
  libraryButtonText: { color: '#fff', fontWeight: '700' },
  libraryDeleteText: { color: '#c62828', fontWeight: '700' },
});
