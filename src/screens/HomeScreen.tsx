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
import { useGemini } from '../hooks/useGemini';

export const HomeScreen = () => {
  const { analyzeScript, analyzePdf, loading, error, scriptData, setScriptData } = useGemini();
  const [fileName, setFileName] = useState<string | null>(null);
  const [myRoles, setMyRoles] = useState<string[]>([]);
  const [isRehearsing, setIsRehearsing] = useState<boolean>(false);

  // --- LÓGICA DE ANIMACIÓN UX PARA CARGAS LARGAS ---
  const progressAnim = useRef(new Animated.Value(0)).current;
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0);

  const loadingMessages = [
    "Subiendo el guión al servidor de IA...",
    "Leyendo las páginas y entendiendo la trama...",
    "Buscando quién es el protagonista...",
    "Separando los diálogos de las acotaciones...",
    "Casi listo, afinando los últimos detalles..."
  ];

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      // 1. Reiniciamos valores
      progressAnim.setValue(0);
      setLoadingMsgIndex(0);

      // 2. Barra Asintótica: Sube al 90% en 20 segundos y se frena dando ilusión de progreso
      Animated.timing(progressAnim, {
        toValue: 90,
        duration: 20000,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false, // Animamos width, no soporta driver nativo
      }).start();

      // 3. Rotamos los mensajes cada 4 segundos
      interval = setInterval(() => {
        setLoadingMsgIndex((prev) => (prev < loadingMessages.length - 1 ? prev + 1 : prev));
      }, 4000);
    } else {
      // 4. Cuando termina de cargar, llenamos al 100% rápido
      Animated.timing(progressAnim, {
        toValue: 100,
        duration: 300,
        useNativeDriver: false,
      }).start();
    }
    return () => clearInterval(interval);
  }, [loading]);

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%']
  });
  // -------------------------------------------------

  const handleTestMock = () => {
    const mockScript = `
      ROMEO Y JULIETA - Escena del Balcón
      ROMEO: ¡Silencio! ¿Qué luz asoma por aquella ventana? Es el oriente, y Julieta es el sol.
      JULIETA: (Suspirando) ¡Ay de mí!
      ROMEO: Habla. ¡Oh, habla otra vez, ángel resplandeciente!
    `;
    setFileName("Script_Prueba.txt");
    analyzeScript(mockScript);
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true
      });

      if (!result.canceled) {
        const file = result.assets[0];
        setFileName(file.name);
        
        let base64Data = '';

        if (Platform.OS === 'web') {
          const res = await fetch(file.uri);
          const blob = await res.blob();
          base64Data = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64String = reader.result as string;
              resolve(base64String.split(',')[1]); 
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } else {
          base64Data = await FileSystem.readAsStringAsync(file.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
        }

        console.log("📄 Enviando PDF a Gemini...");
        analyzePdf(base64Data);
      }
    } catch (err) {
      console.error("Error al procesar el documento:", err);
    }
  };

  const toggleRole = (role: string) => {
    setMyRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  };

  const resetAll = () => {
    setScriptData(null); setFileName(null); setMyRoles([]); setIsRehearsing(false);
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
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
          </View>
        )}

        {loading ? (
          // --- NUEVA VISTA DE CARGA ANIMADA ---
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" style={{ marginBottom: 20 }} />
            
            <View style={styles.progressBarBackground}>
              <Animated.View style={[styles.progressBarFill, { width: progressWidth }]} />
            </View>
            
            <Text style={styles.loadingPercentage}>
              Analizando "{fileName}"
            </Text>
            
            <Text style={styles.loadingMessage}>
              {loadingMessages[loadingMsgIndex]}
            </Text>
          </View>
          // ------------------------------------
        ) : !scriptData ? (
          <View style={styles.uploadSection}>
            <Text style={styles.subtitle}>Sube tu guión y prepárate para ensayar</Text>
            <TouchableOpacity style={styles.buttonMain} onPress={handlePickDocument}>
              <Text style={styles.buttonMainText}>📄 Subir Guión (PDF)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.buttonTest} onPress={handleTestMock}>
              <Text style={styles.buttonTestText}>🧪 Usar Texto de Prueba</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.resultSection}>
            <Text style={styles.resultTitle}>Obra: {scriptData.obra}</Text>
            <Text style={styles.subtitle}>Toca los personajes que vas a interpretar:</Text>
            
            <View style={styles.tagsContainer}>
              {scriptData.personajes.map((personaje, index) => {
                const isSelected = myRoles.includes(personaje);
                return (
                  <TouchableOpacity 
                    key={index} 
                    style={[styles.tag, isSelected && styles.tagSelected]}
                    onPress={() => toggleRole(personaje)}
                  >
                    <Text style={[styles.tagText, isSelected && styles.tagTextSelected]}>
                      {isSelected ? '✅ ' : ''}{personaje}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity 
              style={[styles.buttonMain, { marginTop: 30, opacity: myRoles.length === 0 ? 0.5 : 1 }]} 
              onPress={() => setIsRehearsing(true)}
              disabled={myRoles.length === 0}
            >
              <Text style={styles.buttonMainText}>🎬 Comenzar Ensayo</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.buttonReset} onPress={resetAll}>
              <Text style={styles.buttonResetText}>Cancelar y subir otro</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </ScreenWrapper>
  );
};

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', paddingVertical: 20 },
  title: { fontSize: 32, fontWeight: '800', color: '#111', marginBottom: 5 },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 20, textAlign: 'center' },
  uploadSection: { width: '100%', alignItems: 'center', gap: 15, marginTop: 20 },
  buttonMain: { backgroundColor: '#007AFF', paddingVertical: 16, paddingHorizontal: 30, borderRadius: 12, width: '100%', alignItems: 'center', shadowColor: '#007AFF', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 5 },
  buttonMainText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  buttonTest: { backgroundColor: '#f0f0f0', paddingVertical: 14, paddingHorizontal: 30, borderRadius: 12, width: '100%', alignItems: 'center' },
  buttonTestText: { color: '#333', fontSize: 16, fontWeight: '600' },
  
  // Estilos de la nueva vista de carga
  loadingContainer: { width: '100%', alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 },
  progressBarBackground: { width: '100%', height: 12, backgroundColor: '#e0e0e0', borderRadius: 10, overflow: 'hidden', marginBottom: 15 },
  progressBarFill: { height: '100%', backgroundColor: '#007AFF', borderRadius: 10 },
  loadingPercentage: { fontSize: 16, fontWeight: 'bold', color: '#333', marginBottom: 5, textAlign: 'center' },
  loadingMessage: { fontSize: 14, color: '#666', fontStyle: 'italic', textAlign: 'center' },
  
  errorBox: { backgroundColor: '#ffebee', padding: 15, borderRadius: 8, marginBottom: 20, width: '100%' },
  errorText: { color: '#c62828', fontSize: 14, textAlign: 'center' },
  resultSection: { width: '100%', marginTop: 20 },
  resultTitle: { fontSize: 22, fontWeight: 'bold', marginBottom: 5, color: '#222' },
  tagsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  tag: { backgroundColor: '#e3f2fd', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 20, borderWidth: 1, borderColor: 'transparent' },
  tagSelected: { backgroundColor: '#e8f5e9', borderColor: '#4caf50' },
  tagText: { color: '#007AFF', fontWeight: '600', fontSize: 16 },
  tagTextSelected: { color: '#2e7d32' },
  buttonReset: { marginTop: 20, padding: 10, alignItems: 'center' },
  buttonResetText: { color: '#d32f2f', fontSize: 16, fontWeight: '600' }
});