import * as Speech from 'expo-speech';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Dialogue } from '../hooks/useGemini';

interface Props {
  guion: Dialogue[];
  myRoles: string[];
  onExit: () => void;
}

export const RehearsalView: React.FC<Props> = ({ guion, myRoles, onExit }) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  const currentLine = guion[currentIndex];
  const isMyTurn = currentLine && myRoles.includes(currentLine.p);
  const isFinished = currentIndex >= guion.length;

  // EFECTO DE VOZ (SIRI)
  useEffect(() => {
    Speech.stop(); // Paramos cualquier voz anterior
    
    if (currentLine && currentLine.p !== 'ESCENA_SISTEMA' && !isFinished) {
      if (!isMyTurn) {
        // Si no es mi turno, que hable la IA
        Speech.speak(currentLine.t, { language: 'es-ES', rate: 1.0 });
      }
    }
    
    // Limpieza al desmontar o cambiar de línea
    return () => { Speech.stop(); };
  }, [currentIndex, guion, myRoles, isFinished]);

  const handleExit = () => {
    Speech.stop();
    onExit();
  };

  const getCurrentSceneName = () => {
    for (let i = currentIndex; i >= 0; i--) {
      if (guion[i]?.p === 'ESCENA_SISTEMA') return guion[i].t;
    }
    return "Inicio de Obra";
  };

  const nextScene = () => {
    Speech.stop();
    for (let i = currentIndex + 1; i < guion.length; i++) {
      if (guion[i].p === 'ESCENA_SISTEMA') {
        setCurrentIndex(i + 1);
        return;
      }
    }
  };

  const prevScene = () => {
    Speech.stop();
    let foundCurrent = false;
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (guion[i].p === 'ESCENA_SISTEMA') {
        if (!foundCurrent) {
          foundCurrent = true;
        } else {
          setCurrentIndex(i + 1);
          return;
        }
      }
    }
    setCurrentIndex(0);
  };

  const advanceLine = () => {
    Speech.stop();
    if (currentIndex < guion.length) setCurrentIndex(currentIndex + 1);
  };

  if (currentLine?.p === 'ESCENA_SISTEMA') {
    setTimeout(() => setCurrentIndex(currentIndex + 1), 50);
    return null; 
  }

  return (
    <View style={styles.container}>
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={handleExit}>
          <Text style={styles.headerBtnText}>⬅ Volver</Text>
        </TouchableOpacity>
        
        <View style={styles.sceneControl}>
          <TouchableOpacity onPress={prevScene} style={styles.arrowBtn}><Text style={styles.arrow}>⏮</Text></TouchableOpacity>
          <Text style={styles.sceneTitle} numberOfLines={1}>{getCurrentSceneName()}</Text>
          <TouchableOpacity onPress={nextScene} style={styles.arrowBtn}><Text style={styles.arrow}>⏭</Text></TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollArea}>
        {isFinished ? (
          <View style={styles.finishedBox}>
            <Text style={styles.finishedTitle}>Has llegado al final de las líneas extraídas.</Text>
            <Text style={styles.finishedSub}>Si la IA sigue extrayendo la obra de fondo, en breve aparecerán más diálogos aquí. Pulsa "Volver" para comprobar el progreso.</Text>
            <TouchableOpacity style={styles.btnAdvance} onPress={handleExit}>
              <Text style={styles.btnText}>Volver al Menú</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.dialogueBox}>
            <Text style={[styles.characterName, isMyTurn && styles.myTurnName]}>
              {currentLine.p} {isMyTurn ? "(¡TE TOCA!)" : ""}
            </Text>
            
            {currentLine.a ? <Text style={styles.acotacion}>[{currentLine.a}]</Text> : null}
            
            {isMyTurn ? (
              <View style={styles.myTurnBox}>
                <Text style={styles.myTurnHint}>Recita tu línea y pulsa continuar:</Text>
                <Text style={styles.dialogueTextHidden}>{currentLine.t}</Text>
              </View>
            ) : (
              <Text style={styles.dialogueText}>{currentLine.t}</Text>
            )}
          </View>
        )}
      </ScrollView>

      {!isFinished && (
        <View style={styles.footer}>
          <TouchableOpacity 
            style={[styles.btnAdvance, isMyTurn && styles.btnAdvanceMe]} 
            onPress={advanceLine}
          >
            <Text style={styles.btnText}>{isMyTurn ? 'He dicho mi línea (Siguiente)' : 'Siguiente línea'}</Text>
          </TouchableOpacity>
        </View>
      )}
      
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9f9f9' },
  header: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', 
    backgroundColor: '#fff', paddingTop: 50, paddingBottom: 15, paddingHorizontal: 15,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, elevation: 3, zIndex: 10
  },
  headerBtn: { padding: 8 },
  headerBtnText: { color: '#007AFF', fontWeight: 'bold', fontSize: 16 },
  sceneControl: { flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'center' },
  sceneTitle: { fontSize: 14, fontWeight: 'bold', color: '#333', maxWidth: 120, textAlign: 'center', marginHorizontal: 10 },
  arrowBtn: { paddingHorizontal: 15, paddingVertical: 5, backgroundColor: '#f0f0f0', borderRadius: 8 },
  arrow: { fontSize: 16 },
  scrollArea: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  dialogueBox: { backgroundColor: '#fff', padding: 30, borderRadius: 20, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 2 },
  characterName: { fontSize: 22, fontWeight: '900', color: '#444', marginBottom: 10, textAlign: 'center' },
  myTurnName: { color: '#d32f2f' },
  acotacion: { fontStyle: 'italic', color: '#666', marginBottom: 15, textAlign: 'center', fontSize: 16 },
  dialogueText: { fontSize: 24, color: '#111', lineHeight: 34, textAlign: 'center' },
  myTurnBox: { backgroundColor: '#ffebee', padding: 20, borderRadius: 12, marginTop: 10, borderWidth: 1, borderColor: '#ffcdd2' },
  myTurnHint: { color: '#c62828', fontWeight: 'bold', textAlign: 'center', marginBottom: 10 },
  dialogueTextHidden: { fontSize: 20, color: '#d32f2f', textAlign: 'center', opacity: 0.5 },
  footer: { padding: 20, backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#eee' },
  btnAdvance: { backgroundColor: '#007AFF', padding: 20, borderRadius: 15, alignItems: 'center' },
  btnAdvanceMe: { backgroundColor: '#d32f2f' },
  btnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  finishedBox: { alignItems: 'center', padding: 20 },
  finishedTitle: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 10, textAlign: 'center' },
  finishedSub: { color: '#666', textAlign: 'center', marginBottom: 30, lineHeight: 22 }
});