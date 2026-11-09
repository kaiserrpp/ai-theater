import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { HomeScreen } from './src/screens/HomeScreen';
import { restoreAdminSession } from './src/store/adminSession';

export default function App() {
  useEffect(() => {
    void restoreAdminSession();
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const check = () => { if (document.visibilityState === 'visible') void restoreAdminSession(); };
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    return () => { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, []);
  return <HomeScreen />;
}
