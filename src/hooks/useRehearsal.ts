import * as Speech from 'expo-speech';
import { useCallback, useEffect, useState } from 'react';
import { Dialogue } from './useGemini';

export const useRehearsal = (guion: Dialogue[], myRoles: string[]) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [isFinished, setIsFinished] = useState(false);

  // Función para avanzar a la siguiente línea
  const nextLine = useCallback(() => {
    if (currentIndex < guion.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setIsFinished(true);
      setIsActive(false);
    }
  }, [currentIndex, guion.length]);

  // Efecto principal que controla quién habla
  useEffect(() => {
    if (!isActive || isFinished) return;

    const currentDialogue = guion[currentIndex];
    
    // Si la línea actual es del usuario, nos detenemos y esperamos
    if (myRoles.includes(currentDialogue.p)) {
      Speech.stop(); 
      // La UI mostrará el botón "He dicho mi línea / Siguiente"
      return; 
    }

    // Si es el turno de la IA, leemos la línea
    Speech.stop(); // Paramos cualquier audio previo por seguridad
    Speech.speak(currentDialogue.t, {
      language: 'es-ES',
      rate: 0.9, // Un poco más lento para que suene más natural
      pitch: 1.1, // Tono ligeramente distinto para diferenciar
      onDone: () => {
        // Cuando la IA termina de hablar, avanza automáticamente
        nextLine();
      },
      onError: (err) => {
        console.warn("Error en síntesis de voz:", err);
        nextLine(); // Si falla el audio en Web, avanzamos para no bloquear la app
      }
    });

    // Cleanup: si el componente se desmonta, callamos a la IA
    return () => {
      Speech.stop();
    };
  }, [currentIndex, isActive, isFinished, guion, myRoles, nextLine]);

  const startRehearsal = () => {
    setCurrentIndex(0);
    setIsFinished(false);
    setIsActive(true);
  };

  const stopRehearsal = () => {
    Speech.stop();
    setIsActive(false);
  };

  return {
    currentDialogue: guion[currentIndex],
    currentIndex,
    totalLines: guion.length,
    isFinished,
    isUserTurn: isActive && !isFinished && myRoles.includes(guion[currentIndex]?.p),
    startRehearsal,
    stopRehearsal,
    nextLine,
  };
};