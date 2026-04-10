import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RehearsalView } from '../components/RehearsalView';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { VersionBadge } from '../components/VersionBadge';
import { useGemini } from '../hooks/useGemini';
import { useLibrary } from '../hooks/useLibrary';

export const HomeScreen = () => {
  const { analyzeInStages, loading, error, scriptData, setScriptData, statusText, currentChunkIndex, totalChunks } = useGemini();
  const { savedScripts, saveScript, deleteScript } = useLibrary();

  const [fileName, setFileName] = useState<string | null>(null);
  const [myRoles, setMyRoles] = useState<string[]>([]);
  const [isRehearsing, setIsRehearsing] = useState<boolean>(false);

  // Guardar automáticamente cuando termine todo el proceso
  useEffect(() => {
    if (scriptData && !loading && fileName && currentChunkIndex === totalChunks - 1) {
      saveScript(fileName, scriptData);
    }
  }, [scriptData, loading]);

  const handlePickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf" });
    if (!result.canceled) {
      setFileName(result.assets[0].name);
      analyzeInStages(result.assets[0].uri, 'application/pdf');
    }
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
        
        {error && (
          <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>
        )}

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingMsg}>{statusText}</Text>
            {totalChunks > 0 && (
              <View style={styles.progressBox}>
                <Text style={styles.progressText}>
                  Progreso: {Math.round(((currentChunkIndex + 1) / totalChunks) * 100)}%
                </Text>
                <Text style={styles.subText}>{currentChunkIndex + 1} de {totalChunks} escenas</Text>
              </View>
            )}
            {/* Botón para empezar ya con lo que tengamos procesado */}
            {scriptData && scriptData.guion.length > 5 && (
              <TouchableOpacity style={styles.btnPartial} onPress={() => setIsRehearsing(true)}>
                <Text style={styles.btnText}>🎬 Empezar con lo que hay</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : !scriptData ? (
          <View style={styles.section}>
            <TouchableOpacity style={styles.btnMain} onPress={handlePickDocument}>
              <Text style={styles.btnText}>📄 Subir Guión y Procesar por Escenas</Text>
            </TouchableOpacity>

            {savedScripts.length > 0 && (
              <View style={styles.lib}>
                <Text style={styles.libTitle}>📚 Biblioteca</Text>
                {savedScripts.map(s => (
                  <View key={s.id} style={styles.card}>
                    <TouchableOpacity style={{flex:1}} onPress={() => { setScriptData(s.data); setFileName(s.fileName); }}>
                      <Text style={styles.cardT}>{s.data.obra}</Text>
                      <Text style={styles.cardD}>{s.fileName}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteScript(s.id)}><Text>🗑️</Text></TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.resultTitle}>{scriptData.obra}</Text>
            <Text style={styles.subtitle}>Selecciona tu(s) personaje(s):</Text>
            <View style={styles.tags}>
              {scriptData.personajes.map((p, i) => (
                <TouchableOpacity key={i} style={[styles.tag, myRoles.includes(p) && styles.tagS]} onPress={() => setMyRoles(prev => prev.includes(p) ? prev.filter(r => r!==p) : [...prev, p])}>
                  <Text style={{color: myRoles.includes(p) ? '#2e7d32' : '#007AFF'}}>{myRoles.includes(p) ? '✅ ' : ''}{p}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={styles.btnMain} onPress={() => setIsRehearsing(true)} disabled={myRoles.length === 0}>
              <Text style={styles.btnText}>🎬 Comenzar Ensayo</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setScriptData(null)} style={styles.btnBack}><Text>← Volver</Text></TouchableOpacity>
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
  loadingContainer: { width: '100%', alignItems: 'center', marginTop: 40 },
  loadingMsg: { marginTop: 15, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  progressBox: { marginTop: 20, alignItems: 'center' },
  progressText: { fontSize: 24, fontWeight: 'bold', color: '#007AFF' },
  subText: { fontSize: 14, color: '#666' },
  section: { width: '100%' },
  btnMain: { backgroundColor: '#007AFF', padding: 18, borderRadius: 12, alignItems: 'center' },
  btnPartial: { backgroundColor: '#34C759', padding: 15, borderRadius: 12, marginTop: 30 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  btnBack: { marginTop: 20, alignItems: 'center' },
  errorBox: { backgroundColor: '#ffebee', padding: 15, borderRadius: 8, marginBottom: 20 },
  errorText: { color: '#c62828', textAlign: 'center' },
  lib: { marginTop: 30, width: '100%' },
  libTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  card: { flexDirection: 'row', backgroundColor: '#fff', padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  cardT: { fontWeight: 'bold' },
  cardD: { fontSize: 12, color: '#999' },
  resultTitle: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 10 },
  subtitle: { textAlign: 'center', color: '#666', marginBottom: 15 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20, justifyContent: 'center' },
  tag: { padding: 10, backgroundColor: '#f0f7ff', borderRadius: 15 },
  tagS: { backgroundColor: '#e8f5e9' }
});