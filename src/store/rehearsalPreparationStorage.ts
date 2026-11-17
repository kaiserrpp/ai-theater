import AsyncStorage from '@react-native-async-storage/async-storage';
import { getNativePrototypeInfo } from '../utils/nativePrototype';
import { rehearsalPreparationSession } from '../utils/rehearsalPreparationSession';

export const restoreRehearsalPreparation = () => {
  const native = getNativePrototypeInfo();
  const context = native ? `native-${native.platform}-${native.nativeLevelInput ? 'peak' : 'rms'}` : 'browser';
  rehearsalPreparationSession.configurePersistence({
    key: `@teatro_ia_audio_setup_v1:${context}`, context,
    read: key => AsyncStorage.getItem(key), write: (key, value) => AsyncStorage.setItem(key, value),
  });
  return rehearsalPreparationSession.load();
};
