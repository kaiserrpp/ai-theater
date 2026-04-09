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
import { VersionBadge } from '../components/VersionBadge';
import { useGemini } from '../hooks/useGemini';
import { SavedScript, useLibrary } from '../hooks/useLibrary';

export const HomeScreen = () => {
  // Traemos 'error' y 'setError' (si lo tenemos disponible) para mostrar mensajes
  const { analyzePdf, loading, error, scriptData, setScriptData } = useGemini();
  const { savedScripts, saveScript, deleteScript } = useLibrary();

  const [fileName, setFileName] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null); // Error para fallos locales
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
      setLocalError(null);
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
    setLocalError(null);
  };

  const handlePickDocument = async () => {
    try {
      setLocalError(null);
      const result = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
      
      if (!result.canceled) {
        const file = result.assets[0];
        
        // Verificación de tamaño (Gemini tiene límites en Base64 inline)
        if (file.size && file.size > 15 * 1024 * 1024) {
            setLocalError("El PDF es demasiado grande (máx 15MB).");
            return;
        }

        setFileName(file.name);
        setIsFromLibrary(false);
        
        let base64Data = '';
        try {
            if (Platform.OS === 'web') {
              const res = await fetch(file.uri);
              const blob = await res.blob();
              base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
                reader.onerror = () => reject("Error al leer el archivo en el navegador");
                reader.readAsDataURL(blob);
              });
            } else {
              base64Data = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
            }
            analyzePdf(base64Data);
        } catch (fErr) {
            setLocalError("No se pudo procesar el archivo. ¿Es un PDF válido?");
        }
      }
    } catch (err) { 
        setLocalError("Ocurrió un error al abrir el selector de archivos.");
    }
  };

  const resetAll = () => {
    setScriptData(null); setFileName(null); setMyRoles([]); setIsRehearsing(false); setIsFromLibrary(false); setLocalError(null);
  };

  // UI de Ensayo
  if (isRehearsing && scriptData) {
    return (
      <ScreenWrapper>
        <RehearsalView guion={scriptData.guion} myRoles={myRoles} onExit={() => setIsRehearsing(false)} />
      </ScreenWrapper>
    );
  }

  // UI Principal
  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Teatro IA 🎭</Text>
        
        {/* BLOQUE DE ERROR RECUPERADO */}
        {(error || localError) && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error || localError}</Text>
          </View>
        )}

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <View style={styles.progressBarBackground}>
              <Animated.View style={[styles.progressBarFill, { width: progressAnim.interpolate({inputRange: [0, 100], outputRange: ['0%', '100%']}) }]} />
            </View>
            <Text style={styles.loadingMsg}>Gemini está analizando "{fileName}"...</Text>
            <Text style={styles.loadingSubMsg}>Esto puede tardar hasta 30 segundos en guiones largos.</Text>
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
                      <Text style={styles.cardD}>{s.fileName}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteScript(s.id)}>
                      <Text>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={styles.resultTitle}>{scriptData.obra}</Text>
            <Text style={styles.subtitle}>Personajes detectados:</Text>
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
            <TouchableOpacity onPress={resetAll} style={styles.btnBack}><Text style={{color:'#666'}}>← Volver al inicio</Text></TouchableOpacity>
          </View>
        )}

        <VersionBadge />
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: { padding: 20, alignItems: 'center', flexGrow: 1 },
  title: { fontSize: 32, fontWeight: '800', marginBottom: 20, color: '#111' },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 15 },
  section: { width: '100%' },
  btnMain: { backgroundColor: '#007AFF', padding: 18, borderRadius: 12, alignItems: 'center', shadowOpacity: 0.2, elevation: 4 },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  btnBack: { marginTop: 20, padding: 10, alignItems: 'center' },
  
  errorBox: { backgroundColor: '#ffebee', padding: 15, borderRadius: 8, marginBottom: 20, width: '100%', borderWidth: 1, borderColor: '#ffcdd2' },
  errorText: { color: '#c62828', fontSize: 14, textAlign: 'center', fontWeight: '500' },
  
  loadingContainer: { width: '100%', alignItems: 'center', marginTop: 40 },
  progressBarBackground: { width: '100%', height: 10, backgroundColor: '#eee', borderRadius: 5, marginTop: 20, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#007AFF' },
  loadingMsg: { marginTop: 15, color: '#333', fontWeight: '600', textAlign: 'center' },
  loadingSubMsg: { marginTop: 5, color: '#888', fontSize: 12, textAlign: 'center' },
  
  lib: { marginTop: 40, width: '100%' },
  libTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15, color: '#333' },
  card: { flexDirection: 'row', backgroundColor: '#fff', padding: 15, borderRadius: 12, marginBottom: 10, alignItems: 'center', shadowOpacity: 0.1, elevation: 2, borderWidth: 1, borderColor: '#f0f0f0' },
  cardT: { fontWeight: 'bold', fontSize: 16, color: '#111' },
  cardD: { fontSize: 12, color: '#999', marginTop: 2 },
  deleteBtn: { padding: 10, marginLeft: 10 },
  
  resultTitle: { fontSize: 24, fontWeight: 'bold', marginBottom: 5, color: '#111', textAlign: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 30, justifyContent: 'center', marginTop: 10 },
  tag: { paddingVertical: 10, paddingHorizontal: 15, backgroundColor: '#f0f7ff', borderRadius: 20, borderSize: 1, borderColor: '#d0e5ff' },
  tagS: { backgroundColor: '#e8f5e9', borderColor: '#c8e6c9' }
});