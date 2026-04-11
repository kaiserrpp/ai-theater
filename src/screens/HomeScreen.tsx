import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RehearsalView } from '../components/RehearsalView';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { VersionBadge } from '../components/VersionBadge';
import { useGemini } from '../hooks/useGemini';
import { useScriptRoleMerges } from '../hooks/useScriptRoleMerges';
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
    resetScript,
  } = useGemini();

  const [myRoles, setMyRoles] = useState<string[]>([]);
  const [isRehearsing, setIsRehearsing] = useState(false);
  const [selectedScenes, setSelectedScenes] = useState<string[]>([]);
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);

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
    if (mergeSource && !mergeSourceCandidates.includes(mergeSource)) {
      setMergeSource(null);
    }
  }, [mergeSource, mergeSourceCandidates]);

  useEffect(() => {
    if (mergeTarget && !mergeTargetCandidates.includes(mergeTarget)) {
      setMergeTarget(null);
    }
  }, [mergeTarget, mergeTargetCandidates]);

  const startRehearsal = (mode: 'ALL' | 'MINE') => {
    if (!displayScriptData) {
      return;
    }

    const allScenes = getSceneTitles(displayScriptData.guion);
    setSelectedScenes(mode === 'ALL' ? allScenes : getScenesForRoles(displayScriptData.guion, myRoles));
    setIsRehearsing(true);
  };

  const handleResetScript = () => {
    setMyRoles([]);
    setSelectedScenes([]);
    setIsRehearsing(false);
    setMergeSource(null);
    setMergeTarget(null);
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

  const resumeSceneNumber = pendingJob
    ? Math.min(pendingJob.index + 2, pendingJob.totalChunks.length)
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
            <Text style={styles.obraTitle}>{displayScriptData?.obra}</Text>

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
              <View style={styles.mergePanel}>
                <Text style={styles.mergeTitle}>Fusionar personajes duplicados</Text>
                <Text style={styles.mergeHint}>
                  Une alias o variantes del mismo personaje. Se guardará solo para esta obra.
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
                                {sourceCharacter} → {targetCharacter} · quitar
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
          <TouchableOpacity
            style={styles.btnMain}
            onPress={async () => {
              const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
              if (!result.canceled) {
                setMyRoles([]);
                setSelectedScenes([]);
                await analyzeInStages(result.assets[0].uri, undefined, result.assets[0].name);
              }
            }}
          >
            <Text style={styles.btnText}>Cargar PDF</Text>
          </TouchableOpacity>
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
  errorText: { color: '#c62828', textAlign: 'center', fontWeight: 'bold' },
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
  section: { width: '100%' },
  status: { color: '#007AFF', textAlign: 'center', marginBottom: 10, fontWeight: 'bold' },
  obraTitle: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  label: { color: '#666', marginBottom: 10, textAlign: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 30 },
  mergePanel: {
    marginBottom: 30,
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
  btnMain: { backgroundColor: '#007AFF', padding: 20, borderRadius: 15 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  btnBack: { marginTop: 25, alignSelf: 'center' },
  btnBackText: { color: '#007AFF', fontWeight: '600' },
  buttonDisabled: { opacity: 0.5 },
});
