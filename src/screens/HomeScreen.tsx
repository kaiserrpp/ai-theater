import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RehearsalView } from '../components/RehearsalView';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { VersionBadge } from '../components/VersionBadge';
import { SavedScript, useLibrary } from '../hooks/useLibrary';
import { useGemini } from '../hooks/useGemini';
import { useScriptRoleMerges } from '../hooks/useScriptRoleMerges';
import { RehearsalMode } from '../types/script';
import { normalizeRoleSelection } from '../utils/scriptRoleMerges';
import { getSceneTitles, getScenesForRoles } from '../utils/scriptScenes';

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
  const [lastRehearsalMode, setLastRehearsalMode] = useState<RehearsalMode | null>(null);
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [isMergePanelVisible, setIsMergePanelVisible] = useState(false);

  const {
    isReady: areRoleMergesReady,
    mergeEntries,
    mergeMap,
    mergeSourceCandidates,
    mergedScriptData,
    mergeCharacter,
    removeMerge,
    clearMerges,
  } = useScriptRoleMerges(scriptData);

  const displayScriptData = mergedScriptData ?? scriptData;

  const progressText = useMemo(() => {
    if (!loading) {
      return '';
    }

    if (totalChunks > 0 && currentChunkIndex >= 0) {
      return `${statusText} (${currentChunkIndex + 1}/${totalChunks})`;
    }

    return statusText;
  }, [currentChunkIndex, loading, statusText, totalChunks]);

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
    if (!scriptData || loading) {
      return;
    }

    const fileName = currentScriptFileName ?? scriptData.obra;
    void saveScript(fileName, scriptData, {
      myRoles,
      selectedScenes,
      lastRehearsalMode,
    });
  }, [currentScriptFileName, lastRehearsalMode, loading, myRoles, saveScript, scriptData, selectedScenes]);

  const startRehearsal = (mode: RehearsalMode) => {
    if (!displayScriptData) {
      return;
    }

    const allScenes = getSceneTitles(displayScriptData.guion);
    const scenesToRehearse =
      mode === 'ALL' ? allScenes : getScenesForRoles(displayScriptData.guion, myRoles);

    setSelectedScenes(scenesToRehearse);
    setLastRehearsalMode(mode);
    setIsRehearsing(true);
  };

  const resetSelectionState = () => {
    setMyRoles([]);
    setSelectedScenes([]);
    setLastRehearsalMode(null);
    setIsRehearsing(false);
    setMergeSource(null);
    setMergeTarget(null);
    setIsMergePanelVisible(false);
  };

  const handleResetScript = () => {
    resetSelectionState();
    setCurrentScriptFileName(null);
    resetScript();
  };

  const handleMergeCharacters = () => {
    if (!mergeSource || !mergeTarget) {
      return;
    }

    mergeCharacter(mergeSource, mergeTarget);
    setMergeSource(null);
    setMergeTarget(null);
  };

  const handleOpenSavedScript = (savedScript: SavedScript) => {
    setCurrentScriptFileName(savedScript.fileName);
    setMyRoles(savedScript.config.myRoles);
    setSelectedScenes(savedScript.config.selectedScenes);
    setLastRehearsalMode(savedScript.config.lastRehearsalMode);
    setIsRehearsing(false);
    setMergeSource(null);
    setMergeTarget(null);
    setIsMergePanelVisible(false);
    loadSavedScript(savedScript.data);
  };

  const resumeSceneNumber = pendingJob
    ? Math.min(pendingJob.index + 2, pendingJob.totalChunks.length)
    : null;

  const lastRehearsalLabel =
    lastRehearsalMode === 'ALL'
      ? 'obra completa'
      : lastRehearsalMode === 'MINE'
        ? 'solo mis escenas'
        : null;

  if (isRehearsing && displayScriptData) {
    return (
      <ScreenWrapper>
        <RehearsalView
          guion={displayScriptData.guion}
          myRoles={myRoles}
          filterScenes={selectedScenes}
          onExit={() => setIsRehearsing(false)}
        />
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Teatro IA</Text>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {pendingJob && !loading && !scriptData && (
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

        {loading || displayScriptData ? (
          <View style={styles.section}>
            {loading && <Text style={styles.status}>{progressText}</Text>}
            <Text style={styles.obraTitle}>
              {displayScriptData?.obra ?? currentScriptFileName ?? 'Analizando guion...'}
            </Text>

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

            {!loading && scriptData && (
              <View style={styles.mergeWrapper}>
                <TouchableOpacity
                  style={[styles.btnMenu, styles.mergeToggleButton]}
                  onPress={() => setIsMergePanelVisible((previousValue) => !previousValue)}
                >
                  <Text style={styles.btnText}>
                    {isMergePanelVisible ? 'Ocultar fusiones' : 'Fusionar personajes'}
                    {mergeEntries.length > 0 ? ` (${mergeEntries.length})` : ''}
                  </Text>
                </TouchableOpacity>

                {isMergePanelVisible ? (
                  <View style={styles.mergePanel}>
                    <Text style={styles.mergeTitle}>Fusionar personajes duplicados</Text>
                    <Text style={styles.mergeHint}>
                      Une alias o variantes del mismo personaje. Se guardara solo para esta obra.
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

            <View style={styles.menu}>
              <TouchableOpacity
                style={[styles.btnMenu, myRoles.length === 0 && styles.buttonDisabled]}
                onPress={() => startRehearsal('ALL')}
                disabled={myRoles.length === 0}
              >
                <Text style={styles.btnText}>Ensayar obra completa</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnMenu, styles.btnSecondary, myRoles.length === 0 && styles.buttonDisabled]}
                onPress={() => startRehearsal('MINE')}
                disabled={myRoles.length === 0}
              >
                <Text style={styles.btnText}>Solo mis escenas</Text>
              </TouchableOpacity>
            </View>

            {!loading && (
              <TouchableOpacity onPress={handleResetScript} style={styles.btnBack}>
                <Text style={styles.btnBackText}>Cambiar guion</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.homeContent}>
            <TouchableOpacity
              style={styles.btnMain}
              onPress={async () => {
                const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
                if (!result.canceled) {
                  resetSelectionState();
                  setCurrentScriptFileName(result.assets[0].name ?? null);
                  await analyzeInStages(result.assets[0].uri, undefined, result.assets[0].name);
                }
              }}
            >
              <Text style={styles.btnText}>Cargar PDF</Text>
            </TouchableOpacity>

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
                      </View>

                      <View style={styles.libraryActions}>
                        <TouchableOpacity
                          style={[styles.libraryButton, styles.libraryOpenButton]}
                          onPress={() => handleOpenSavedScript(savedScript)}
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
  title: { fontSize: 30, fontWeight: 'bold', marginBottom: 20 },
  errorBox: { backgroundColor: '#ffebee', padding: 15, borderRadius: 8, marginBottom: 20, width: '100%' },
  errorText: {
    color: '#c62828',
    textAlign: 'left',
    fontWeight: '600',
    fontSize: 12,
    lineHeight: 18,
  },
  resumeBox: {
    backgroundColor: '#e8f5e9',
    padding: 20,
    borderRadius: 15,
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  resumeTitle: { fontWeight: 'bold', marginBottom: 10 },
  btnResume: { backgroundColor: '#4CAF50', padding: 12, borderRadius: 10, width: '100%', alignItems: 'center' },
  discardButton: { marginTop: 10 },
  discardText: { color: '#c62828', fontWeight: '600' },
  homeContent: { width: '100%', gap: 24 },
  section: { width: '100%' },
  status: { color: '#007AFF', textAlign: 'center', marginBottom: 10, fontWeight: 'bold' },
  obraTitle: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  summaryCard: {
    marginBottom: 20,
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#eef7ff',
    borderWidth: 1,
    borderColor: '#d4e7ff',
  },
  summaryTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  summaryText: { textAlign: 'center', color: '#34506b', lineHeight: 20 },
  label: { color: '#666', marginBottom: 10, textAlign: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 30 },
  mergeWrapper: { marginBottom: 30 },
  mergeToggleButton: { marginBottom: 12 },
  mergePanel: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#e4e8ee',
  },
  mergeTitle: { fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  mergeHint: { color: '#5f6b7a', textAlign: 'center', marginBottom: 16, lineHeight: 20 },
  mergeLoading: { textAlign: 'center', color: '#5f6b7a' },
  mergeStep: { fontWeight: '600', marginBottom: 10, textAlign: 'center' },
  mergeAction: { marginTop: -8, marginBottom: 20 },
  mergeList: { gap: 10 },
  mergeChip: {
    backgroundColor: '#eef5ff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  mergeChipText: { color: '#215a9a', textAlign: 'center', fontWeight: '600' },
  clearMergeButton: { marginTop: 14, alignSelf: 'center' },
  clearMergeText: { color: '#c62828', fontWeight: '600' },
  tag: { padding: 10, backgroundColor: '#f0f7ff', borderRadius: 15, borderWidth: 1, borderColor: '#d0e3ff' },
  tagSelected: { backgroundColor: '#e8f5e9', borderColor: '#a5d6a7' },
  tagText: { color: '#007AFF' },
  tagTextSelected: { color: '#1b5e20', fontWeight: '600' },
  menu: { gap: 12 },
  btnMenu: { backgroundColor: '#007AFF', padding: 18, borderRadius: 12, alignItems: 'center' },
  btnSecondary: { backgroundColor: '#34C759' },
  btnMain: { backgroundColor: '#007AFF', padding: 20, borderRadius: 15, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  btnBack: { marginTop: 25, alignSelf: 'center' },
  btnBackText: { color: '#007AFF', fontWeight: '600' },
  buttonDisabled: { opacity: 0.5 },
  librarySection: {
    width: '100%',
    padding: 18,
    borderRadius: 18,
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#eceff3',
  },
  libraryTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 6 },
  libraryHint: { textAlign: 'center', color: '#5f6b7a', marginBottom: 18, lineHeight: 20 },
  libraryList: { gap: 14 },
  libraryCard: {
    borderRadius: 16,
    backgroundColor: '#fff',
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
  libraryOpenButton: { backgroundColor: '#007AFF', borderColor: '#007AFF' },
  libraryDeleteButton: { backgroundColor: '#fff5f5', borderColor: '#f3c5c5' },
  libraryButtonText: { color: '#fff', fontWeight: '700' },
  libraryDeleteText: { color: '#c62828', fontWeight: '700' },
});
