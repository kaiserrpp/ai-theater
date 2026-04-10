import * as Speech from 'expo-speech';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Dialogue } from '../hooks/useGemini';

interface Props { guion: Dialogue[]; myRoles: string[]; filterScenes: string[]; onExit: () => void; }

export const RehearsalView: React.FC<Props> = ({ guion, myRoles, filterScenes, onExit }) => {
  const filteredGuion = guion.filter((line, index) => {
    let currentScene = "";
    for (let i = index; i >= 0; i--) {
      if (guion[i].p === 'ESCENA_SISTEMA') { currentScene = guion[i].t; break; }
    }
    return filterScenes.includes(currentScene);
  });

  const [currentIndex, setCurrentIndex] = useState(0);
  const currentLine = filteredGuion[currentIndex];
  const isMyTurn = currentLine && myRoles.includes(currentLine.p);
  const isFinished = currentIndex >= filteredGuion.length;

  const advanceLine = () => {
    if (currentIndex < filteredGuion.length) setCurrentIndex(prev => prev + 1);
  };

  useEffect(() => {
    Speech.stop();
    if (!isFinished && currentLine && currentLine.p !== 'ESCENA_SISTEMA') {
      if (!isMyTurn) {
        Speech.speak(currentLine.t, { 
          language: 'es-ES',
          onDone: () => setTimeout(advanceLine, 500)
        });
      }
    }
    return () => Speech.stop();
  }, [currentIndex]);

  const handleExit = () => { Speech.stop(); onExit(); };

  if (currentLine?.p === 'ESCENA_SISTEMA') {
    return (
      <View style={styles.intro}>
        <Text style={styles.introTitle}>Escena: {currentLine.t}</Text>
        <TouchableOpacity style={styles.btnNext} onPress={advanceLine}>
          <Text style={styles.btnText}>Empezar esta escena</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleExit} style={{marginTop:20}}><Text>Salir</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleExit}><Text style={styles.blue}>Cerrar Ensayo</Text></TouchableOpacity>
        <Text style={styles.sceneName}>Ensayando {filterScenes.length} escenas</Text>
      </View>

      <ScrollView contentContainerStyle={styles.center}>
        {isFinished ? (
          <View style={{alignItems:'center'}}>
            <Text style={{fontSize:20, fontWeight:'bold'}}>¡Fin del ensayo!</Text>
            <TouchableOpacity onPress={handleExit} style={styles.btnBack}><Text style={styles.btnText}>Volver al inicio</Text></TouchableOpacity>
          </View>
        ) : (
          <View style={[styles.box, isMyTurn && styles.myBox]}>
            <Text style={[styles.name, isMyTurn && {color: 'red'}]}>
              {currentLine?.p}
            </Text>
            {currentLine?.a ? <Text style={styles.acot}>[{currentLine.a}]</Text> : null}
            
            {/* TEXTO AHORA VISIBLE PARA EL USUARIO */}
            <Text style={[styles.text, isMyTurn && styles.myText]}>{currentLine?.t}</Text>
            
            {isMyTurn && <Text style={styles.myTurnHint}>👆 (Tu turno: lee y pulsa siguiente)</Text>}
          </View>
        )}
      </ScrollView>

      {!isFinished && (
        <TouchableOpacity style={[styles.footer, isMyTurn && {backgroundColor: 'red'}]} onPress={advanceLine}>
          <Text style={styles.btnText}>{isMyTurn ? 'HECHO (Siguiente)' : 'Saltar línea'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { paddingTop: 60, padding: 20, flexDirection: 'row', borderBottomWidth: 1, borderColor: '#eee', justifyContent:'space-between', alignItems:'center' },
  blue: { color: '#007AFF', fontWeight: 'bold' },
  sceneName: { fontSize: 12, color: '#666' },
  center: { flexGrow: 1, justifyContent: 'center', padding: 25 },
  intro: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  introTitle: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 30 },
  box: { padding: 30, borderRadius: 20, backgroundColor: '#f8f9fa', alignItems: 'center' },
  myBox: { backgroundColor: '#fff0f0', borderWidth: 2, borderColor: 'red' },
  name: { fontSize: 22, fontWeight: '900', marginBottom: 10 },
  acot: { fontStyle: 'italic', color: '#666', marginBottom: 15 },
  text: { fontSize: 26, textAlign: 'center', lineHeight: 38 },
  myText: { color: '#d32f2f', fontWeight: '500' },
  myTurnHint: { marginTop: 20, fontSize: 14, color: '#d32f2f', fontWeight: 'bold' },
  footer: { backgroundColor: '#007AFF', padding: 25, alignItems: 'center' },
  btnNext: { backgroundColor: '#007AFF', padding: 20, borderRadius: 15, width: '100%', alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  btnBack: { backgroundColor: '#333', padding: 15, borderRadius: 10, marginTop: 20 }
});