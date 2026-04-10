import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RehearsalView } from '../components/RehearsalView';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { VersionBadge } from '../components/VersionBadge';
import { useGemini } from '../hooks/useGemini';
import { useLibrary } from '../hooks/useLibrary';

export const HomeScreen = () => {
  const { analyzeInStages, loading, error, scriptData, setScriptData, statusText, currentChunkIndex, totalChunks, clearCheckpoint } = useGemini();
  const { savedScripts, saveScript, deleteScript } = useLibrary();

  const [fileName, setFileName] = useState<string | null>(null);
  const [myRoles, setMyRoles] = useState<string[]>([]);
  const [isRehearsing, setIsRehearsing] = useState<boolean>(false);
  const [pendingJob, setPendingJob] = useState<any>(null);

  // Al arrancar, buscamos si hay un proceso a medias
  useEffect(() => {
    const checkPending = async () => {
      const data = await AsyncStorage.getItem('@pending_job');
      if (data) setPendingJob(JSON.parse(data));
    };
    checkPending();
  }, [loading]);

  useEffect(() => {
    if (scriptData && !loading && fileName && currentChunkIndex === totalChunks - 1) {
      saveScript(fileName, scriptData);
    }
  }, [scriptData, loading]);

  const handlePickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf" });
    if (!result.canceled) {
      setFileName(result.assets[0].name);
      analyzeInStages(result.assets[0].uri);
    }
  };

  const handleResume = () => {
    setFileName("Guion recuperado");
    analyzeInStages(null, pendingJob);
    setPendingJob(null);
  };

  const handleDeletePending = () => {
    Alert.alert("Borrar progreso", "¿Seguro que quieres descartar el guion a medias?", [
      { text: "No" },
      { text: "Sí, borrar", onPress: async () => { await clearCheckpoint(); setPendingJob(null); } }
    ]);
  };

  if (isRehearsing && scriptData) {
    return (
      <ScreenWrapper>
        <RehearsalView guion={scriptData.guion} myRoles={myRoles} onExit={() => setIsRehearsing(false)} />
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Teatro IA 🎭</Text>
        
        {pendingJob && !loading && !scriptData && (
          <View style={styles.resumeBox}>
            <Text style={styles.resumeTitle}>📍 Tienes un guion a medias</Text>
            <Text style={styles.resumeText}>Se quedó en la escena {pendingJob.index + 1} de {pendingJob.totalChunks.length}.</Text>
            <TouchableOpacity style={styles.btnResume} onPress={handleResume}>
              <Text style={styles.btnText}>Continuar procesando</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDeletePending} style={{marginTop: 10}}>
              <Text style={{color: '#d32f2f', fontSize: 12}}>Descartar este progreso</Text>
            </TouchableOpacity>
          </View>
        )}

        {loading || scriptData ? (
          <View style={styles.section}>
            {loading && (
              <View style={styles.loadingHeader}>
                <ActivityIndicator size="small" color="#007AFF" />
                <Text style={styles.statusText}>{statusText} ({currentChunkIndex + 1}/{totalChunks})</Text>
              </View>
            )}
            <Text style={styles.resultTitle}>{scriptData?.obra || "Cargando..."}</Text>
            <View style={styles.tags}>
              {scriptData?.personajes.map((p, i) => (
                <TouchableOpacity key={i} style={[styles.tag, myRoles.includes(p) && styles.tagS]} onPress={() => setMyRoles(prev => prev.includes(p) ? prev.filter(r => r !== p) : [...prev, p])}>
                  <Text style={{color: myRoles.includes(p) ? '#2e7d32' : '#007AFF'}}>{myRoles.includes(p) ? '✅ ' : ''}{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={[styles.btnMain, myRoles.length === 0 && {backgroundColor: '#ccc'}]} onPress={() => setIsRehearsing(true)} disabled={myRoles.length === 0}>
              <Text style={styles.btnText}>🎬 Comenzar Ensayo ({scriptData?.guion.length || 0} líneas)</Text>
            </TouchableOpacity>
            {!loading && <TouchableOpacity onPress={() => setScriptData(null)} style={styles.btnBack}><Text>← Volver</Text></TouchableOpacity>}
          </View>
        ) : (
          <View style={styles.section}>
            <TouchableOpacity style={styles.btnMain} onPress={handlePickDocument}>
              <Text style={styles.btnText}>📄 Subir Nuevo Guión (PDF)</Text>
            </TouchableOpacity>
            <View style={styles.lib}>
                <Text style={styles.libTitle}>📚 Biblioteca</Text>
                {savedScripts.map(s => (
                  <View key={s.id} style={styles.card}>
                    <TouchableOpacity style={{flex:1}} onPress={() => { setScriptData(s.data); setFileName(s.fileName); }}>
                      <Text style={styles.cardT}>{s.data.obra}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteScript(s.id)}><Text>🗑️</Text></TouchableOpacity>
                  </View>
                ))}
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
  title: { fontSize: 32, fontWeight: '800', marginBottom: 20 },
  resumeBox: { width: '100%', backgroundColor: '#fff', padding: 20, borderRadius: 15, marginBottom: 20, borderLeftWidth: 5, borderLeftColor: '#34C759', shadowOpacity: 0.1, elevation: 3, alignItems: 'center' },
  resumeTitle: { fontWeight: 'bold', fontSize: 16, marginBottom: 5 },
  resumeText: { color: '#666', fontSize: 13, marginBottom: 15 },
  btnResume: { backgroundColor: '#34C759', padding: 12, borderRadius: 10, width: '100%', alignItems: 'center' },
  section: { width: '100%' },
  btnMain: { backgroundColor: '#007AFF', padding: 18, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold' },
  loadingHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#eee', padding: 10, borderRadius: 20, marginBottom: 20 },
  statusText: { marginLeft: 10, color: '#007AFF', fontWeight: '600', fontSize: 12 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20, justifyContent: 'center' },
  tag: { padding: 10, backgroundColor: '#f0f7ff', borderRadius: 15 },
  tagS: { backgroundColor: '#e8f5e9' },
  lib: { marginTop: 30, width: '100%' },
  libTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  card: { flexDirection: 'row', backgroundColor: '#fff', padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  cardT: { fontWeight: 'bold' },
  btnBack: { marginTop: 20, alignItems: 'center' },
  errorBox: { backgroundColor: '#ffebee', padding: 15, borderRadius: 8, marginBottom: 20 },
  errorText: { color: '#c62828' },
  resultTitle: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 }
});