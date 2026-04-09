import React, { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Dialogue } from '../hooks/useGemini';
import { useRehearsal } from '../hooks/useRehearsal';

interface Props {
  guion: Dialogue[];
  myRoles: string[];
  onExit: () => void;
}

export const RehearsalView = ({ guion, myRoles, onExit }: Props) => {
  const { 
    currentDialogue, currentIndex, totalLines, 
    isFinished, isUserTurn, startRehearsal, stopRehearsal, nextLine 
  } = useRehearsal(guion, myRoles);

  // Arrancamos el ensayo en cuanto se monta la vista
  useEffect(() => {
    startRehearsal();
    return () => stopRehearsal(); // Cleanup al salir
  }, []);

  if (isFinished) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.title}>¡Ensayo Finalizado! 🎬</Text>
        <TouchableOpacity style={styles.buttonMain} onPress={onExit}>
          <Text style={styles.buttonText}>Volver al menú</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Barra superior de progreso */}
      <View style={styles.header}>
        <Text style={styles.progressText}>
          Línea {currentIndex + 1} de {totalLines}
        </Text>
        <TouchableOpacity onPress={onExit} style={styles.exitButton}>
          <Text style={styles.exitText}>Salir</Text>
        </TouchableOpacity>
      </View>

      {/* Tarjeta del diálogo actual */}
      <ScrollView contentContainerStyle={styles.dialogueCard}>
        <Text style={[styles.characterName, isUserTurn ? styles.userColor : styles.aiColor]}>
          {currentDialogue.p}
        </Text>
        
        {currentDialogue.a ? (
          <Text style={styles.acotacion}>({currentDialogue.a})</Text>
        ) : null}
        
        <Text style={styles.dialogueText}>{currentDialogue.t}</Text>
      </ScrollView>

      {/* Controles inferiores */}
      <View style={styles.footer}>
        {isUserTurn ? (
          <TouchableOpacity style={[styles.buttonMain, styles.userAction]} onPress={nextLine}>
            <Text style={styles.buttonText}>Ya he dicho mi línea 🎤</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.buttonMain, styles.aiAction]}>
            <Text style={styles.aiSpeakingText}>El compañero está hablando... 🔊</Text>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  progressText: { fontSize: 16, fontWeight: '600', color: '#666' },
  exitButton: { padding: 8, backgroundColor: '#ffebee', borderRadius: 8 },
  exitText: { color: '#c62828', fontWeight: 'bold' },
  dialogueCard: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  characterName: { fontSize: 28, fontWeight: '900', marginBottom: 10, textAlign: 'center' },
  userColor: { color: '#2e7d32' }, // Verde para ti
  aiColor: { color: '#007AFF' }, // Azul para el compañero
  acotacion: { fontSize: 16, fontStyle: 'italic', color: '#888', marginBottom: 15, textAlign: 'center' },
  dialogueText: { fontSize: 24, lineHeight: 34, color: '#333', textAlign: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 30, color: '#222' },
  footer: { width: '100%', paddingVertical: 20 },
  buttonMain: { paddingVertical: 18, borderRadius: 12, alignItems: 'center', width: '100%' },
  buttonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  userAction: { backgroundColor: '#4caf50', shadowColor: '#4caf50', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 5 },
  aiAction: { backgroundColor: '#e3f2fd' },
  aiSpeakingText: { color: '#007AFF', fontSize: 18, fontWeight: 'bold' }
});