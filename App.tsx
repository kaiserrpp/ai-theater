import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Text, View } from 'react-native';
import { HomeScreen } from './src/screens/HomeScreen';
import { restoreAdminSession } from './src/store/adminSession';
import { getNativePrototypeInfo, isNativePrototypeShell, NATIVE_READY_EVENT } from './src/utils/nativePrototype';

export default function App() {
  const [nativeReady, setNativeReady] = useState(() => !isNativePrototypeShell() || Boolean(getNativePrototypeInfo()));
  const [nativeError, setNativeError] = useState(false);
  useEffect(() => {
    if (nativeReady || Platform.OS !== 'web') return;
    const ready = () => { if (getNativePrototypeInfo()) setNativeReady(true); };
    ready(); window.addEventListener(NATIVE_READY_EVENT, ready);
    const timer = setTimeout(() => setNativeError(true), 10000);
    return () => { clearTimeout(timer); window.removeEventListener(NATIVE_READY_EVENT, ready); };
  }, [nativeReady]);
  useEffect(() => {
    void restoreAdminSession();
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const check = () => { if (document.visibilityState === 'visible') void restoreAdminSession(); };
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    return () => { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, []);
  if (!nativeReady) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
    {!nativeError ? <ActivityIndicator /> : null}
    <Text>{nativeError ? 'No se ha podido conectar el reconocimiento nativo. Cierra el prototipo y vuelve a abrirlo.' : 'Conectando el reconocimiento del teléfono…'}</Text>
  </View>;
  return <HomeScreen />;
}
