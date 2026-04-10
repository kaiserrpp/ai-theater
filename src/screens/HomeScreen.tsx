import * as DocumentPicker from 'expo-document-picker';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RehearsalView } from '../components/RehearsalView';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { VersionBadge } from '../components/VersionBadge';
import { useGemini } from '../hooks/useGemini';
import { useLibrary } from '../hooks/useLibrary';

export const HomeScreen = () => {
  const { analyzeScript, analyzeCharactersOnly, loading, error, scriptData, setScriptData, statusText } = useGemini();
  const { savedScripts, saveScript, deleteScript } = useLibrary();

  const [fileName, setFileName] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [myRoles, setMyRoles] = useState<string[]>([]);
  const [isRehearsing, setIsRehearsing] = useState<boolean>(false);
  const [isFromLibrary, setIsFromLibrary] = useState<boolean>(false);

  useEffect(() => {
    if (scriptData && !isFromLibrary && fileName && !loading) {
      saveScript(fileName, scriptData);
      setIsFromLibrary(true);
    }
  }, [scriptData, loading, isFromLibrary, fileName]);

  const progressAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (loading) {
      progressAnim.setValue(0);
      Animated.timing(progressAnim, { toValue: 100, duration: 30000, easing: Easing.linear, useNativeDriver: false }).start();
    }
  }, [loading]);

  const handlePick = async (testMode: boolean) => {
    try {
      setLocalError(null);
      const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf" });
      if (!result.canceled) {
        const file = result.assets[0];
        setFileName(file.name);
        setIsFromLibrary(false);
        if (testMode) {
          analyzeCharactersOnly(file.uri, 'application/pdf');
        } else {
          analyzeScript(file.uri, 'application/pdf');
        }
      }
    } catch (err) { setLocalError("Error al seleccionar"); }
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
        
        {(error || localError) && (
          <View style={styles.errorBox}><Text style={styles.errorText}>⚠️ {error || localError}</Text></View>
        )}

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <View style={styles.progressBarBackground}>
              <Animated.View style={[styles.progressBarFill, { width: progressAnim.interpolate({inputRange: [0, 100], outputRange: ['0%', '100%']}) }]} />
            </View>
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
        ) : !scriptData ? (
          <View style={styles.section}>
            <TouchableOpacity style={styles.btnMain} onPress={() => handlePick(false)}>
              <Text style={styles.btnText}>📄 Analizar Obra COMPLETA</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={[styles.btnMain, {marginTop: 15, backgroundColor: '#34C759'}]} onPress={() => handlePick(true)}>
              <Text style={styles.btnText}>⚡ TEST: Solo Personajes (Rápido)</Text>
            </TouchableOpacity>

            {savedScripts.length > 0 && (
              <View style={styles.lib}>
                <Text style={styles.libTitle}>📚 Biblioteca</Text>
                {savedScripts.map(s => (
                  <View key={s.id} style={styles.card}>
                    <TouchableOpacity style={{flex:1}} onPress={() => { setFileName(s.fileName); setScriptData(s.data); setIsFromLibrary(true); }}>
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
            <TouchableOpacity onPress={() => {setScriptData(null); setFileName(null);}} style={styles.btnBack}><Text>← Volver</Text></TouchableOpacity>
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
  section: { width: '100%' },
  btnMain: { backgroundColor: '#007AFF', padding: 18, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  btnBack: { marginTop: 20, alignItems: 'center' },
  errorBox: { backgroundColor: '#ffebee', padding: 15, borderRadius: 8, marginBottom: 20, width: '100%' },
  errorText: { color: '#c62828', textAlign: 'center' },
  loadingContainer: { width: '100%', alignItems: 'center', marginTop: 40 },
  progressBarBackground: { width: '100%', height: 8, backgroundColor: '#eee', borderRadius: 4, marginTop: 20, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#007AFF' },
  statusText: { marginTop: 15, color: '#007AFF', fontWeight: '600', textAlign: 'center' },
  lib: { marginTop: 30 },
  libTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  card: { flexDirection: 'row', backgroundColor: '#fff', padding: 15, borderRadius: 12, marginBottom: 10, alignItems: 'center', borderWidth: 1, borderColor: '#eee' },
  cardT: { fontWeight: 'bold' },
  cardD: { fontSize: 12, color: '#999' },
  resultTitle: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', marginBottom: 10 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20, justifyContent: 'center' },
  tag: { padding: 10, backgroundColor: '#f0f7ff', borderRadius: 15 },
  tagS: { backgroundColor: '#e8f5e9' }
});