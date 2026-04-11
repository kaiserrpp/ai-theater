import * as DocumentPicker from 'expo-document-picker';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RehearsalView } from '../components/RehearsalView';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { VersionBadge } from '../components/VersionBadge';
import { useGemini } from '../hooks/useGemini';
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

  const progressText = useMemo(() => {
    if (!loading) {
      return '';
    }

    if (totalChunks > 0 && currentChunkIndex >= 0) {
      return `${statusText} (${currentChunkIndex + 1}/${totalChunks})`;
    }

    return statusText;
  }, [currentChunkIndex, loading, statusText, totalChunks]);

  const startRehearsal = (mode: 'ALL' | 'MINE') => {
    if (!scriptData) {
      return;
    }

    const allScenes = getSceneTitles(scriptData.guion);
    setSelectedScenes(mode === 'ALL' ? allScenes : getScenesForRoles(scriptData.guion, myRoles));
    setIsRehearsing(true);
  };

  const handleResetScript = () => {
    setMyRoles([]);
    setSelectedScenes([]);
    setIsRehearsing(false);
    resetScript();
  };

  const resumeSceneNumber = pendingJob
    ? Math.min(pendingJob.index + 2, pendingJob.totalChunks.length)
    : null;

  if (isRehearsing && scriptData) {
    return (
      <ScreenWrapper>
        <RehearsalView
          guion={scriptData.guion}
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

        {loading || scriptData ? (
          <View style={styles.section}>
            {loading && <Text style={styles.status}>{progressText}</Text>}
            <Text style={styles.obraTitle}>{scriptData?.obra}</Text>

            <Text style={styles.label}>Personajes detectados (elige el tuyo):</Text>
            <View style={styles.tags}>
              {scriptData?.personajes.map((character) => (
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
                await analyzeInStages(result.assets[0].uri);
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
