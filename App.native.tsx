import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import * as Speech from 'expo-speech';
import appManifest from './app.json';
import packageInfo from './package.json';
import { nativeBridgeBootstrap } from './src/nativePrototype/bridgeBootstrap';
import { createNativePrototypeController } from './src/nativePrototype/controller';
import { isPrototypeUrl, parseBridgeCommand, type NativePlatform } from './src/nativePrototype/protocol';

const platform: NativePlatform = Platform.OS === 'ios' ? 'ios' : 'android';
const appUrl = appManifest.expo.extra.nativePrototype.webUrl;

function NativePrototype() {
  const web = useRef<WebView>(null);
  const [permission, setPermission] = useState<'checking' | 'needed' | 'ready'>('checking');
  const [error, setError] = useState('');
  const bootstrap = useMemo(() => nativeBridgeBootstrap({ platform, appVersion: packageInfo.version }), []);
  const controller = useMemo(() => createNativePrototypeController({
    emit: event => web.current?.injectJavaScript(`window.__AI_THEATRE_NATIVE_RECEIVE__ && window.__AI_THEATRE_NATIVE_RECEIVE__(${JSON.stringify(event)});true;`),
    requestPermission: async () => (await ExpoSpeechRecognitionModule.getPermissionsAsync()).granted,
    isRecognitionAvailable: () => ExpoSpeechRecognitionModule.isRecognitionAvailable(),
    startRecognition: options => ExpoSpeechRecognitionModule.start({ ...options,
      // Older Android services end each utterance. The shared session keeps
      // its words and reopens input; only Intelligent text matching advances.
      continuous: platform === 'android' && Number(Platform.Version) < 33 ? false : options.continuous,
      interimResults: true, maxAlternatives: 1,
      requiresOnDeviceRecognition: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
      addsPunctuation: false, recordingOptions: { persist: false },
      iosTaskHint: 'dictation', iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth'], mode: 'measurement' },
    }),
    abortRecognition: () => ExpoSpeechRecognitionModule.abort(),
    stopRecognition: () => ExpoSpeechRecognitionModule.stop(),
    speak: (text, options) => Speech.speak(text, { language: options.lang, rate: options.rate, pitch: options.pitch,
      volume: options.volume, voice: options.voice, onStart: options.onStart, onDone: options.onDone,
      onError: cause => options.onError(cause instanceof Error ? cause.message : 'No se pudo reproducir la voz.'),
    }),
    stopSpeech: () => Speech.stop(),
    voices: async () => (await Speech.getAvailableVoicesAsync()).map(voice => ({ id: voice.identifier,
      name: voice.name, lang: voice.language, default: voice.language.toLowerCase().startsWith('es-es') })),
  }), []);
  useEffect(() => {
    let live = true;
    void ExpoSpeechRecognitionModule.getPermissionsAsync().then(value => {
      if (live) setPermission(value.granted ? 'ready' : 'needed');
    }).catch(() => { if (live) setPermission('needed'); });
    const subscriptions = [
      ExpoSpeechRecognitionModule.addListener('start', () => controller.recognitionEvent('start')),
      ExpoSpeechRecognitionModule.addListener('audiostart', () => controller.recognitionEvent('audiostart')),
      ExpoSpeechRecognitionModule.addListener('audioend', () => controller.recognitionEvent('audioend')),
      ExpoSpeechRecognitionModule.addListener('end', () => controller.recognitionEvent('end')),
      ExpoSpeechRecognitionModule.addListener('result', event => controller.recognitionEvent('result', {
        text: event.results[0]?.transcript || '', isFinal: event.isFinal,
      })),
      ExpoSpeechRecognitionModule.addListener('error', event => {
        if (event.error === 'interrupted') controller.setForeground(false);
        controller.recognitionEvent('error', { error: event.error, message: event.message });
      }),
      AppState.addEventListener('change', state => {
        // Permission sheets and Control Center can be merely inactive. Only
        // actual backgrounding suspends; returning active always notifies JS.
        if (state === 'background') controller.setForeground(false);
        else if (state === 'active') controller.setForeground(true);
      }),
    ];
    return () => { live = false; controller.dispose(); subscriptions.forEach(item => item.remove()); };
  }, [controller]);
  const requestPermission = async () => {
    setError(''); setPermission('checking');
    try {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      setPermission(result.granted ? 'ready' : 'needed');
      if (!result.granted) setError('Activa el micrófono y el reconocimiento de voz en los ajustes de AI-Theatre.');
    } catch { setPermission('needed'); setError('No se han podido comprobar los permisos. Puedes reintentarlo.'); }
  };
  return <SafeAreaView style={styles.screen}>
    <View style={styles.heading}><Text style={styles.headingText}>AI-Theatre · Prototipo {platform === 'ios' ? 'iPhone' : 'Android'} · {packageInfo.version}</Text></View>
    {permission === 'checking' ? <View style={styles.center}><ActivityIndicator /><Text>Comprobando permisos…</Text></View> :
      permission !== 'ready' ? <View style={styles.center}>
        <Text style={styles.title}>Prueba del ensayo nativo</Text>
        <Text style={styles.description}>Activa el micrófono para ensayar con el reconocimiento del teléfono. Después podrás abrir tu obra y usar el modo Inteligente y sus pausas.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => void requestPermission()}><Text style={styles.buttonText}>Activar micrófono y reconocimiento</Text></Pressable>
        {error ? <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()}><Text style={styles.description}>Abrir ajustes de permisos</Text></Pressable> : null}
      </View> : error ? <View style={styles.center}><Text style={styles.error}>{error}</Text>
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => { controller.setForeground(true); setError(''); }}><Text style={styles.buttonText}>Reintentar conexión</Text></Pressable>
      </View> : <WebView ref={web} source={{ uri: appUrl }} style={styles.web}
        originWhitelist={[new URL(appUrl).origin]} javaScriptEnabled domStorageEnabled sharedCookiesEnabled
        allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        applicationNameForUserAgent={`AITheatreNative/${packageInfo.version} (${platform})`}
        injectedJavaScriptBeforeContentLoaded={bootstrap} injectedJavaScriptBeforeContentLoadedForMainFrameOnly injectedJavaScript={bootstrap}
        onMessage={event => {
          if (!isPrototypeUrl(event.nativeEvent.url, appUrl)) return;
          const command = parseBridgeCommand(event.nativeEvent.data); if (command) controller.handle(command);
        }}
        onShouldStartLoadWithRequest={request => {
          if (request.url === 'about:blank' || isPrototypeUrl(request.url, appUrl)) return true;
          if (request.isTopFrame !== false && /^https:\/\//i.test(request.url)) void Linking.openURL(request.url);
          return false;
        }}
        onLoadEnd={() => controller.handle({ channel: 'ai-theatre-native', protocol: 1, type: 'hello' })}
        onError={() => { controller.setForeground(false); setError('No se ha podido abrir la obra. Comprueba la conexión y reintenta.'); }}
      />}
  </SafeAreaView>;
}

export default function App() { return <SafeAreaProvider><NativePrototype /></SafeAreaProvider>; }
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#faf9f7' }, web: { flex: 1, backgroundColor: '#faf9f7' },
  heading: { padding: 8, borderBottomWidth: 1, borderColor: '#e4dce1' }, headingText: { textAlign: 'center', fontSize: 11, color: '#713d59' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 26, gap: 20 },
  title: { fontSize: 23, fontWeight: '700', textAlign: 'center' }, description: { fontSize: 16, lineHeight: 24, textAlign: 'center' },
  error: { fontSize: 16, color: '#9e2424', textAlign: 'center' },
  button: { padding: 18, borderRadius: 16, backgroundColor: '#713d59' }, buttonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
});
