import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import React, { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Animated, Easing,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import { RehearsalView } from '../components/RehearsalView';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { VersionBadge } from '../components/VersionBadge'; // <-- Importamos nuestro nuevo componente
import { useGemini } from '../hooks/useGemini';
import { SavedScript, useLibrary } from '../hooks/useLibrary';

export const HomeScreen = () => {
  const { analyzePdf, loading, error, scriptData, setScriptData } = useGemini();
  const { savedScripts, saveScript, deleteScript } = useLibrary();

  const [fileName, setFileName] = useState<string | null>(null);
  const [myRoles, setMyRoles] = useState<string[]>([]);
  const [isRehearsing, setIsRehearsing] = useState<boolean>(false);
  const [isFromLibrary, setIsFromLibrary] = useState<boolean>(false);

  // Auto-guardado al recibir datos de la IA
  useEffect(() => {
    if (scriptData && !isFromLibrary && fileName && !loading) {
      saveScript(fileName, scriptData);
      setIsFromLibrary(true);
    }
  }, [scriptData, loading, isFromLibrary, fileName]);

  // Animación de carga
  const progressAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (loading) {
      progressAnim.setValue(0);
      Animated.timing(progressAnim, { toValue: 90, duration: 25000, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    } else {
      Animated.timing(progressAnim, { toValue: 100, duration: 500, useNativeDriver: false }).start();
    }
  }, [loading]);

  const loadSavedScript = (script: SavedScript) => {
    setFileName(script.fileName);
    setScriptData(script.data);
    setIsFromLibrary(true);
    setMyRoles([]);
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
      if (!result.canceled) {
        const file = result.assets[0];
        setFileName(file.name);
        setIsFromLibrary(false);
        
        let base64Data = '';
        if (Platform.OS === 'web') {
          const res = await fetch(file.uri);
          const blob = await res.blob();
          base64Data = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
            reader.readAsDataURL(blob);
          });
        } else {
          base64Data = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
        }
        analyzePdf(base64Data);
      }
    } catch (err) { console.error(err); }
  };

  const resetAll = () => {
    setScriptData(null); setFileName(null); setMyRoles([]); setIsRehearsing(false); setIsFromLibrary(false);
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
        
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <View style={styles.progressBarBackground}>
              <Animated.View style={[styles.progressBarFill, { width: progressAnim.interpolate({inputRange: [0, 100], outputRange: ['0%', '100%']}) }]} />
            </View>
            <Text style={styles.loadingMsg}>Gemini está procesando tu guión...</Text>
          </View>
        ) : !scriptData ? (
          <View style={styles.section}>
            <TouchableOpacity style={styles.btnMain} onPress={handlePickDocument}>
              <Text style={styles.btnText}>📄 Subir Guión Nuevo (PDF)</Text>
            </TouchableOpacity>

            {savedScripts.length > 0 && (
              <View style={styles.lib}>
                <Text style={styles.libTitle}>📚 Tus Guiones Guardados</Text>
                {savedScripts.map(s => (
                  <View key={s.id} style={styles.card}>
                    <TouchableOpacity style={{flex:1}} onPress={() => loadSavedScript(s)}>
                      <Text style={styles.cardT}>{s.data.obra}</Text>
                      <Text style={styles.cardD}>{s.date}</Text>
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
            <TouchableOpacity onPress={resetAll} style={{marginTop:20, alignItems: 'center'}}><Text style={{color:'red'}}>Volver</Text></TouchableOpacity>
          </View>
        )}

        {/* Nuestro nuevo chivato de versión */}
        <VersionBadge />
        
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20, alignItems: 'center', flexGrow: 1 },
  title: { fontSize: 32, fontWeight: '800', marginBottom: 20 },
  section: { width: '100%' },
  btnMain: { backgroundColor: '#007AFF', padding: 18, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  loadingContainer: { width: '100%', alignItems: 'center', marginTop: 40 },
  progressBarBackground: { width: '100%', height: 10, backgroundColor: '#eee', borderRadius: 5, marginTop: 20, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#007AFF' },
  loadingMsg: { marginTop: 10, color: '#666' },
  lib: { marginTop: 40, width: '100%' },
  libTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15 },
  card: { flexDirection: 'row', backgroundColor: '#fff', padding: 15, borderRadius: 12, marginBottom: 10, alignItems: 'center', shadowOpacity: 0.1, elevation: 2 },
  cardT: { fontWeight: 'bold', fontSize: 16 },
  cardD: { fontSize: 12, color: '#999' },
  resultTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 10 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 30 },
  tag: { padding: 10, backgroundColor: '#e3f2fd', borderRadius: 20 },
  tagS: { backgroundColor: '#e8f5e9' }
});