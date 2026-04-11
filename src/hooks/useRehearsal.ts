import * as Speech from 'expo-speech';
import { useCallback, useEffect, useState } from 'react';
import { Dialogue } from '../types/script';

export const useRehearsal = (guion: Dialogue[], myRoles: string[]) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [isFinished, setIsFinished] = useState(false);

  const nextLine = useCallback(() => {
    if (currentIndex < guion.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setIsFinished(true);
      setIsActive(false);
    }
  }, [currentIndex, guion.length]);

  useEffect(() => {
    if (!isActive || isFinished) {
      return;
    }

    const currentDialogue = guion[currentIndex];
    if (!currentDialogue) {
      return;
    }

    if (myRoles.includes(currentDialogue.p)) {
      Speech.stop();
      return;
    }

    Speech.stop();
    Speech.speak(currentDialogue.t, {
      language: 'es-ES',
      rate: 0.9,
      pitch: 1.1,
      onDone: () => {
        nextLine();
      },
      onError: (error) => {
        console.warn('Error en sintesis de voz:', error);
        nextLine();
      },
    });

    return () => {
      Speech.stop();
    };
  }, [currentIndex, guion, isActive, isFinished, myRoles, nextLine]);

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
    isUserTurn: isActive && !isFinished && myRoles.includes(guion[currentIndex]?.p ?? ''),
    startRehearsal,
    stopRehearsal,
    nextLine,
  };
};
