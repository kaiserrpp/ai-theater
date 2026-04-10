import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RehearsalView } from '../components/RehearsalView';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { VersionBadge } from '../components/VersionBadge';
import { useGemini } from '../hooks/useGemini';
import { useLibrary } from '../hooks/useLibrary';

export const HomeScreen = () => {
  const { analyzeInStages, loading, error, scriptData, setScriptData, statusText, currentChunkIndex, totalChunks, clearCheckpoint } = useGemini();
  const { savedScripts, saveScript, deleteScript } = useLibrary();

  const [myRoles, setMyRoles] = useState<string[]>([]);
  const [isRehearsing, setIsRehearsing] = useState<boolean>(false);
  const [pendingJob, setPendingJob] = useState<any>(null);
  const [selectedScenes, setSelectedScenes] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem('@pending_job').then(d => { if(d) setPendingJob(JSON.parse(d)); });
  }, [loading]);

  const startRehearsal = (mode: 'ALL' | 'MINE') => {
    const allScenes = scriptData?.guion.filter(l => l.p === 'ESCENA_SISTEMA').map(l => l.t) || [];
    if (mode === 'ALL') {
      setSelectedScenes(allScenes);
    } else {
      const mine = allScenes.filter(sceneTitle => {
        const start = scriptData?.guion.findIndex(l => l.p === 'ESCENA_SISTEMA' && l.t === sceneTitle) || 0;
        const endIdx = scriptData?.guion.findIndex((l, i) => i > start && l.p === 'ESCENA_SISTEMA');
        const slice = scriptData?.guion.slice(start, endIdx === -1 ? undefined : endIdx);
        return slice?.some(l => myRoles.includes(l.p));
      });
      setSelectedScenes(mine);
    }
    setIsRehearsing(true);
  };

  const handleResume = () => {
    const jobToResume = pendingJob;
    setPendingJob(null);
    analyzeInStages(null, jobToResume);
  };

  if (isRehearsing && scriptData) {
    return (
      <ScreenWrapper>
        <RehearsalView guion={scriptData.guion} myRoles={myRoles} filterScenes={selectedScenes} onExit={() => setIsRehearsing(false)} />
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Teatro IA 🎭</Text>

        {/* ¡AQUÍ ESTÁ! LA CAJA DE ERRORES QUE BORRÉ POR ACCIDENTE */}
        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
          </View>
        )}

        {pendingJob && !loading && !scriptData && (
          <View style={styles.resumeBox}>
            <Text style={styles.resumeTitle}>📍 Guion incompleto detectado</Text>
            <TouchableOpacity style={styles.btnResume} onPress={handleResume}>
              <Text style={styles.btnText}>Retomar (Escena {pendingJob.index + 1})</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={async () => { await clearCheckpoint(); setPendingJob(null); }} style={{marginTop:10}}><Text style={{color:'red'}}>Descartar</Text></TouchableOpacity>
          </View>
        )}

        {(loading || scriptData) ? (
          <View style={styles.section}>
            {loading && <Text style={styles.status}>{statusText} ({currentChunkIndex+1}/{totalChunks})</Text>}
            <Text style={styles.obraTitle}>{scriptData?.obra}</Text>
            
            <Text style={styles.label}>Personajes detectados (elige el tuyo):</Text>
            <View style={styles.tags}>
              {scriptData?.personajes.map(p => (
                <TouchableOpacity key={p} style={[styles.tag, myRoles.includes(p) && styles.tagS]} onPress={() => setMyRoles(prev => prev.includes(p) ? prev.filter(r=>r!==p) : [...prev, p])}>
                  <Text style={{color: myRoles.includes(p) ? 'green' : '#007AFF'}}>{myRoles.includes(p) ? '✅ ' : ''}{p}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.menu}>
              <TouchableOpacity style={[styles.btnMenu, myRoles.length===0 && {opacity:0.5}]} onPress={() => startRehearsal('ALL')} disabled={myRoles.length===0}>
                <Text style={styles.btnText}>▶️ Ensayar Obra Completa</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btnMenu, {backgroundColor:'#34C759'}, myRoles.length===0 && {opacity:0.5}]} onPress={() => startRehearsal('MINE')} disabled={myRoles.length===0}>
                <Text style={styles.btnText}>🎭 Solo mis escenas</Text>
              </TouchableOpacity>
            </View>
            
            {!loading && <TouchableOpacity onPress={() => setScriptData(null)} style={styles.btnBack}><Text>← Cambiar Guion</Text></TouchableOpacity>}
          </View>
        ) : (
          <TouchableOpacity style={styles.btnMain} onPress={async () => {
            const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf" });
            if (!res.canceled) analyzeInStages(res.assets[0].uri);
          }}><Text style={styles.btnText}>📄 Cargar PDF</Text></TouchableOpacity>
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
  resumeBox: { backgroundColor: '#e8f5e9', padding: 20, borderRadius: 15, width: '100%', alignItems: 'center', marginBottom: 20 },
  resumeTitle: { fontWeight: 'bold', marginBottom: 10 },
  btnResume: { backgroundColor: '#4CAF50', padding: 12, borderRadius: 10, width: '100%', alignItems: 'center' },
  section: { width: '100%' },
  status: { color: '#007AFF', textAlign: 'center', marginBottom: 10, fontWeight: 'bold' },
  obraTitle: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  label: { color: '#666', marginBottom: 10, textAlign: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 30 },
  tag: { padding: 10, backgroundColor: '#f0f7ff', borderRadius: 15, borderWidth: 1, borderColor: '#d0e3ff' },
  tagS: { backgroundColor: '#e8f5e9', borderColor: '#a5d6a7' },
  menu: { gap: 12 },
  btnMenu: { backgroundColor: '#007AFF', padding: 18, borderRadius: 12, alignItems: 'center' },
  btnMain: { backgroundColor: '#007AFF', padding: 20, borderRadius: 15 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  btnBack: { marginTop: 25, alignSelf: 'center' }
});