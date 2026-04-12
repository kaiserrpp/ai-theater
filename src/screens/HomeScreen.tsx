import { Asset } from 'expo-asset';
import * as DocumentPicker from 'expo-document-picker';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  buildSharedScriptUrl,
  copySharedScriptUrl,
  fetchSharedScript,
  getSharedScriptIdFromUrl,
  publishSharedScript,
  replaceSharedScriptIdInUrl,
} from '../api/sharedScripts';
import { RehearsalView } from '../components/RehearsalView';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { VersionBadge } from '../components/VersionBadge';
import { SavedScript, useLibrary } from '../hooks/useLibrary';
import { useGemini } from '../hooks/useGemini';
import { useScriptRoleMerges } from '../hooks/useScriptRoleMerges';
import { RehearsalCheckpoint, RehearsalCheckpointMap, RehearsalMode } from '../types/script';
import { SharedScriptManifest } from '../types/sharedScript';
import { CharacterMergeMap, normalizeRoleSelection } from '../utils/scriptRoleMerges';
import { areSceneSelectionsEqual, filterScriptByScenes, getSceneTitles, getScenesForRoles, isSongCue } from '../utils/scriptScenes';

const demoPdfModule = require('../../assets/demo/demo.pdf');

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

const buildSongPlaceholders = (guion: SharedScriptManifest['scriptData']['guion']) => {
  const occurrences = new Map<string, number>();

  return guion
    .filter((line) => isSongCue(line))
    .map((line) => {
      const title = line.songTitle || 'Cancion';
      const currentCount = occurrences.get(title) ?? 0;
      const nextCount = currentCount + 1;
      occurrences.set(title, nextCount);

      return {
        id: `song-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cue'}-${nextCount}`,
        title,
        audioUrl: null,
        audioFileName: null,
        updatedAt: new Date().toISOString(),
      };
    });
};

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
  const [pendingResumeMode, setPendingResumeMode] = useState<RehearsalMode | null>(null);
  const [sharedScript, setSharedScript] = useState<SharedScriptManifest | null>(null);
  const [sharedStatusText, setSharedStatusText] = useState('');
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [isSharingScript, setIsSharingScript] = useState(false);
  const [isLoadingSharedScript, setIsLoadingSharedScript] = useState(false);
  const [isHydratingSharedMergeMap, setIsHydratingSharedMergeMap] = useState(false);

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
      return getScenesForRoles(displayScriptData.guion, myRoles);
    }

    return selectedScenes;
  }, [displayScriptData, myRoles, pendingResumeMode, selectedScenes]);

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
        return getScenesForRoles(displayScriptData.guion, myRoles);
      }

      return selectedScenes;
    },
    [displayScriptData, myRoles, selectedScenes]
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

  const handleLoadDemo = useCallback(async () => {
    const demoAsset = Asset.fromModule(demoPdfModule);

    if (!demoAsset.localUri) {
      await demoAsset.downloadAsync();
    }

    const demoFileName = demoAsset.name ? `${demoAsset.name}.${demoAsset.type ?? 'pdf'}` : 'demo.pdf';

    resetSelectionState();
    replaceSharedScriptIdInUrl(null);
    setCurrentScriptFileName(demoFileName);
    await analyzeInStages(demoAsset.localUri ?? demoAsset.uri, undefined, demoFileName);
  }, [analyzeInStages]);

  const loadRemoteSharedScript = useCallback(async (shareId: string) => {
    setIsLoadingSharedScript(true);
    setSharedError(null);
    setSharedStatusText('Cargando obra compartida...');

    try {
      const manifest = await fetchSharedScript(shareId);

      resetSelectionState();
      setIsHydratingSharedMergeMap(true);
      setCurrentScriptFileName(manifest.fileName);
      setSharedScript(manifest);
      setSharedStatusText('');
      setSharedError(null);
      replaceSharedScriptIdInUrl(manifest.shareId);
      loadSavedScript(manifest.scriptData);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'No se pudo abrir la obra compartida.';
      setSharedError(`Error compartiendo: ${message}`);
      setSharedStatusText('');
    } finally {
      setIsLoadingSharedScript(false);
    }
  }, [loadSavedScript]);

  const handlePublishSharedScript = useCallback(async () => {
    if (!scriptData) {
      return;
    }

    setIsSharingScript(true);
    setSharedError(null);
    setSharedStatusText(sharedScript ? 'Actualizando obra compartida...' : 'Publicando obra compartida...');

    try {
      const response = await publishSharedScript({
        shareId: sharedScript?.shareId ?? null,
        fileName: currentScriptFileName ?? scriptData.obra,
        scriptData,
        mergeMap,
        songs: sharedScript?.songs?.length ? sharedScript.songs : buildSongPlaceholders(scriptData.guion),
      });

      setSharedScript(response.manifest);
      setSharedStatusText('Obra compartida lista para enviar.');
      setIsHydratingSharedMergeMap(false);
      replaceSharedScriptIdInUrl(response.manifest.shareId);
      await copySharedScriptUrl(response.manifest.shareId);
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
      await loadRemoteSharedScript(savedScript.config.sharedScriptId);
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

  const lastRehearsalLabel =
    lastRehearsalMode === 'ALL'
      ? 'obra completa'
      : lastRehearsalMode === 'MINE'
        ? 'mis escenas'
        : lastRehearsalMode === 'SELECTED'
          ? 'escenas seleccionadas'
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
          initialIndex={rehearsalStartIndex}
          onProgressChange={handleRehearsalProgressChange}
          onExit={() => setIsRehearsing(false)}
        />
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

            {!!displayScriptData && (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Configuracion guardada para esta obra</Text>
                <Text style={styles.summaryText}>
                  {myRoles.length > 0
                    ? `${myRoles.length} personaje${myRoles.length === 1 ? '' : 's'} seleccionado${myRoles.length === 1 ? '' : 's'}`
                    : 'Todavia no has elegido personaje'}
                </Text>
                <Text style={styles.summaryText}>
                  {selectedScenes.length > 0
                    ? `${selectedScenes.length} escena${selectedScenes.length === 1 ? '' : 's'} recordada${selectedScenes.length === 1 ? '' : 's'}`
                    : 'Aun no has guardado una seleccion de escenas'}
                </Text>
                {lastRehearsalLabel ? (
                  <Text style={styles.summaryText}>Ultimo modo usado: {lastRehearsalLabel}</Text>
                ) : null}
              </View>
            )}

            {!!displayScriptData && (
              <View style={styles.shareCard}>
                <Text style={styles.shareTitle}>
                  {sharedScript ? 'Obra compartida activa' : 'Compartir esta obra'}
                </Text>
                <Text style={styles.shareText}>
                  {sharedScript
                    ? 'Esta obra ya tiene un enlace compartido. Las fusiones se sincronizan entre quienes abran ese enlace.'
                    : 'Crea un enlace compartido para que otras personas carguen este mismo guion con las fusiones ya hechas.'}
                </Text>
                {sharedScript ? (
                  <Text style={styles.shareLink}>{buildSharedScriptUrl(sharedScript.shareId)}</Text>
                ) : null}
                <View style={styles.shareActions}>
                  <TouchableOpacity
                    style={[styles.shareButton, sharedScript ? styles.shareButtonSecondary : styles.shareButtonPrimary]}
                    onPress={() => void handlePublishSharedScript()}
                    disabled={isSharingScript}
                  >
                    <Text
                      style={[
                        styles.shareButtonText,
                        sharedScript ? styles.shareButtonSecondaryText : styles.shareButtonPrimaryText,
                      ]}
                    >
                      {sharedScript ? 'Actualizar enlace' : 'Compartir obra'}
                    </Text>
                  </TouchableOpacity>
                  {sharedScript ? (
                    <TouchableOpacity
                      style={[styles.shareButton, styles.shareButtonSecondary]}
                      onPress={() => void copySharedScriptUrl(sharedScript.shareId)}
                    >
                      <Text style={[styles.shareButtonText, styles.shareButtonSecondaryText]}>Copiar enlace</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            )}

            <View style={styles.actionStack}>
              <View style={styles.roleWrapper}>
                <TouchableOpacity
                  style={[styles.btnMenu, styles.roleToggleButton]}
                  onPress={() => setIsRolePanelVisible((previousValue) => !previousValue)}
                >
                  <Text style={styles.btnText}>
                    {isRolePanelVisible ? 'Ocultar seleccion de personajes' : 'Seleccion de personajes'}
                    {myRoles.length > 0 ? ` (${myRoles.length})` : ''}
                  </Text>
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
                  <Text style={styles.btnText}>
                    {isScenePanelVisible ? 'Ocultar seleccion de escenas' : 'Seleccion de escenas'}
                    {selectedScenes.length > 0 ? ` (${selectedScenes.length})` : ''}
                  </Text>
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
                    style={[styles.btnMenu, myRoles.length === 0 && styles.buttonDisabled]}
                    onPress={() => requestRehearsalStart('ALL')}
                    disabled={myRoles.length === 0}
                  >
                    <Text style={styles.btnText}>Ensayar obra completa</Text>
                  </TouchableOpacity>
                  {renderResumeChoiceForMode('ALL')}
                </View>
                <View style={styles.menuOption}>
                  <TouchableOpacity
                    style={[styles.btnMenu, styles.btnSecondary, myRoles.length === 0 && styles.buttonDisabled]}
                    onPress={() => requestRehearsalStart('MINE')}
                    disabled={myRoles.length === 0}
                  >
                    <Text style={styles.btnText}>Ensayar mis escenas</Text>
                  </TouchableOpacity>
                  {renderResumeChoiceForMode('MINE')}
                </View>
                <View style={styles.menuOption}>
                  <TouchableOpacity
                    style={[styles.btnMenu, styles.btnTertiary, selectedScenes.length === 0 && styles.buttonDisabled]}
                    onPress={() => requestRehearsalStart('SELECTED')}
                    disabled={selectedScenes.length === 0}
                  >
                    <Text style={styles.btnText}>Ensayar escenas seleccionadas</Text>
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
                    <Text style={styles.btnText}>
                      {isMergePanelVisible ? 'Ocultar fusion de personajes' : 'Fusion de personajes'}
                      {mergeEntries.length > 0 ? ` (${mergeEntries.length})` : ''}
                    </Text>
                  </TouchableOpacity>

                  {isMergePanelVisible ? (
                    <View style={styles.mergePanel}>
                      <Text style={styles.mergeTitle}>Fusionar personajes duplicados</Text>
                      <Text style={styles.mergeHint}>
                        {sharedScript
                          ? 'Une alias o variantes del mismo personaje. Esta fusion se compartira con quien abra este enlace.'
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

            {!effectiveLoading && (
              <TouchableOpacity onPress={handleResetScript} style={styles.btnBack}>
                <Text style={styles.btnBackText}>Cambiar guion</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.homeContent}>
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

              <TouchableOpacity style={[styles.btnMain, styles.btnDemo]} onPress={() => void handleLoadDemo()}>
                <Text style={styles.btnText}>Cargar demo</Text>
              </TouchableOpacity>
            </View>

            {savedScripts.length > 0 ? (
              <View style={styles.librarySection}>
                <Text style={styles.libraryTitle}>Obras guardadas</Text>
                <Text style={styles.libraryHint}>Abre una obra y retomaras tu configuracion guardada.</Text>

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
              </View>
            ) : null}
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
  homeActions: { gap: 12 },
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
  summaryCard: {
    marginBottom: 20,
    padding: 18,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(214, 231, 255, 0.9)',
  },
  summaryTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 10, color: '#1d2733' },
  summaryText: { textAlign: 'center', color: '#34506b', lineHeight: 20 },
  shareCard: {
    marginBottom: 20,
    padding: 18,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.84)',
    borderWidth: 1,
    borderColor: 'rgba(220, 231, 245, 0.92)',
    gap: 12,
  },
  shareTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center', color: '#17324c' },
  shareText: { textAlign: 'center', color: '#34506b', lineHeight: 20 },
  shareLink: {
    textAlign: 'center',
    color: '#184e77',
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 8,
  },
  shareActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  shareButton: {
    minWidth: 180,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  shareButtonPrimary: {
    backgroundColor: 'rgba(24, 78, 119, 0.88)',
    borderColor: 'rgba(24, 78, 119, 0.88)',
  },
  shareButtonSecondary: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderColor: 'rgba(199, 214, 232, 0.94)',
  },
  shareButtonText: { fontWeight: '700' },
  shareButtonPrimaryText: { color: '#fff' },
  shareButtonSecondaryText: { color: '#184e77' },
  actionStack: { gap: 14 },
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
  btnDemo: { backgroundColor: 'rgba(124, 77, 45, 0.82)' },
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
  libraryCardBody: { gap: 4 },
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
