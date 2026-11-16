import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';
import { createVocalPracticeHistory } from '../utils/vocalPracticeHistory';

export const vocalPractice = createVocalPracticeHistory(AsyncStorage);
export const useVocalPractice = () => {
  const history = useSyncExternalStore(vocalPractice.subscribe, vocalPractice.getSnapshot, vocalPractice.getSnapshot);
  useEffect(() => { void vocalPractice.load(); }, []);
  return history;
};
