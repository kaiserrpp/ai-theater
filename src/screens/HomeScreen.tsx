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

  const toggleRole = (role: string) => {
    setMyRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
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
        
        {error && <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error}</Text></View>}

        {(loading || scriptData) && !isRehearsing ? (
          <View style={styles.section}>
            {loading && (
              <View style={styles.loadingHeader}>
                <ActivityIndicator size="small" color="#007AFF" />
                <Text style={styles.statusText}>{statusText} ({currentChunkIndex + 1}/{totalChunks})</Text>
              </View>
            )}

            <Text style={styles.resultTitle}>{scriptData?.obra || "Procesando..."}</Text>
            
            <Text style={styles.subtitle}>Selecciona tu personaje (puedes hacerlo ya):</Text>
            <View style={styles.tags}>
              {scriptData?.personajes.map((p, i) => (
                <TouchableOpacity 
                  key={i} 
                  style={[styles.tag, myRoles.includes(p) && styles.tagS]} 
                  onPress={() => toggleRole(p)}
                >
                  <Text style={{color: myRoles.includes(p) ? '#2e7d32' : '#007AFF'}}>
                    {myRoles.includes(p) ? '✅ ' : ''}{p}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity 
              style={[styles.btnMain, myRoles.length === 0 && {backgroundColor: '#ccc'}]} 
              onPress={() => setIsRehearsing(true)} 
              disabled={myRoles.length === 0}
            >
              <Text style={styles.btnText}>🎬 Comenzar Ensayo ({scriptData?.guion.length || 0} líneas)</Text>
            </TouchableOpacity>

            {!loading && (
              <TouchableOpacity onPress={() => {setScriptData(null); setMyRoles([]);}} style={styles.btnBack}>
                <Text style={{color: '#666'}}>← Volver</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.section}>
            <TouchableOpacity style={styles.btnMain} onPress={handlePickDocument}>
              <Text style={styles.btnText}>📄 Subir Guión (PDF)</Text>
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
        )}
        <VersionBadge />
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20, alignItems: 'center' },
  title: { fontSize: 32, fontWeight: '800', marginBottom: 20 },
  loadingHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f0f0', padding: 10, borderRadius: 20, marginBottom: 20 },
  statusText: { marginLeft: 10, color: '#007AFF', fontWeight: '600', fontSize: 12 },
  section: { width: '100%' },
  btnMain: { backgroundColor: '#007AFF', padding: 18, borderRadius: 12, alignItems: 'center' },
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
  subtitle: { textAlign: 'center', color: '#666', marginBottom: 15, fontSize: 14 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 30, justifyContent: 'center' },
  tag: { padding: 10, backgroundColor: '#f0f7ff', borderRadius: 15, borderWidth: 1, borderColor: '#d0e3ff' },
  tagS: { backgroundColor: '#e8f5e9', borderColor: '#a5d6a7' }
});