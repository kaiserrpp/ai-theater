import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import * as Speech from 'expo-speech';
import { AudioModule, RecordingPresets } from 'expo-audio';
import { deleteAsync } from 'expo-file-system/legacy';
import { createNativeLevelInput } from './src/nativePrototype/levelInput';
import { createNativeRecognitionRuntime } from './src/nativePrototype/recognitionRuntime';
import appManifest from './app.json';
import packageInfo from './package.json';
import { nativeBridgeBootstrap } from './src/nativePrototype/bridgeBootstrap';
import { createNativePrototypeController } from './src/nativePrototype/controller';
import { isPrototypeUrl, parseBridgeCommand, type NativePlatform } from './src/nativePrototype/protocol';

const platform: NativePlatform = Platform.OS === 'ios' ? 'ios' : 'android';
const appUrl = appManifest.expo.extra.nativePrototype.webUrl;
const privacyUrl = 'https://ai-theater.vercel.app/privacidad.html';

function NativePrototype() {
  const web = useRef<WebView>(null);
  const [permission, setPermission] = useState<'checking' | 'needed' | 'ready'>('checking');
  const [error, setError] = useState('');
  const bootstrap = useMemo(() => nativeBridgeBootstrap({ platform, appVersion: packageInfo.version, nativeLevelInput: platform === 'android', recognitionHints: true }), []);
  const recognitionRuntime = useMemo(() => createNativeRecognitionRuntime({
    platform, androidVersion: Number(Platform.Version), onDevice: ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
    getSupportedLocales: () => ExpoSpeechRecognitionModule.getSupportedLocales({}),
    start: options => ExpoSpeechRecognitionModule.start({ ...options,
      continuous: platform === 'android' && Number(Platform.Version) < 33 ? false : options.continuous,
      interimResults: true, maxAlternatives: 1, addsPunctuation: false, recordingOptions: { persist: false },
      iosTaskHint: 'dictation', iosCategory: { category: 'playAndRecord', categoryOptions: ['defaultToSpeaker', 'allowBluetooth'], mode: 'measurement' },
    }),
  }), []);
  const levelInput = useMemo(() => createNativeLevelInput({
    createRecorder: () => {
      const recorder = new AudioModule.AudioRecorder({ ...RecordingPresets.HIGH_QUALITY,
        ...RecordingPresets.HIGH_QUALITY.android, numberOfChannels: 1, isMeteringEnabled: true });
      return { get uri() { return recorder.uri; }, prepareToRecordAsync: () => recorder.prepareToRecordAsync(),
        record: () => recorder.record({ forDuration: 30 }), getStatus: () => recorder.getStatus(),
        stop: () => recorder.stop(), release: () => recorder.release() };
    },
    deleteRecording: uri => deleteAsync(uri, { idempotent: true }),
  }), []);
  const controller = useMemo(() => createNativePrototypeController({
    emit: event => web.current?.injectJavaScript(`window.__AI_THEATRE_NATIVE_RECEIVE__ && window.__AI_THEATRE_NATIVE_RECEIVE__(${JSON.stringify(event)});true;`),
    requestPermission: async () => (await ExpoSpeechRecognitionModule.getPermissionsAsync()).granted,
    isRecognitionAvailable: () => ExpoSpeechRecognitionModule.isRecognitionAvailable(),
    startRecognition: recognitionRuntime.start,
    abortRecognition: () => { recognitionRuntime.stopped(); ExpoSpeechRecognitionModule.abort(); },
    stopRecognition: () => { recognitionRuntime.stopped(); ExpoSpeechRecognitionModule.stop(); },
    speak: (text, options) => Speech.speak(text, { language: options.lang, rate: options.rate, pitch: options.pitch,
      volume: options.volume, voice: options.voice, onStart: options.onStart, onDone: options.onDone,
      onError: cause => options.onError(cause instanceof Error ? cause.message : 'No se pudo reproducir la voz.'),
    }),
    stopSpeech: () => Speech.stop(),
    voices: async () => (await Speech.getAvailableVoicesAsync()).map(voice => ({ id: voice.identifier,
      name: voice.name, lang: voice.language, default: voice.language.toLowerCase().startsWith('es-es') })),
    startLevelInput: levelInput.start,
    stopLevelInput: levelInput.stop,
  }), [levelInput, recognitionRuntime]);
  useEffect(() => {
    let live = true;
    void recognitionRuntime.warm();
    void ExpoSpeechRecognitionModule.getPermissionsAsync().then(value => {
      if (live) setPermission(value.granted ? 'ready' : 'needed');
    }).catch(() => { if (live) setPermission('needed'); });
    const subscriptions = [
      ExpoSpeechRecognitionModule.addListener('start', () => controller.recognitionEvent('start')),
      ExpoSpeechRecognitionModule.addListener('audiostart', () => controller.recognitionEvent('audiostart')),
      ExpoSpeechRecognitionModule.addListener('audioend', () => controller.recognitionEvent('audioend')),
      ExpoSpeechRecognitionModule.addListener('end', () => { recognitionRuntime.stopped(); controller.recognitionEvent('end'); }),
      ExpoSpeechRecognitionModule.addListener('result', event => controller.recognitionEvent('result', {
        text: event.results[0]?.transcript || '', isFinal: event.isFinal,
      })),
      ExpoSpeechRecognitionModule.addListener('error', event => {
        if (event.error === 'interrupted') controller.setForeground(false);
        controller.recognitionEvent('error', { error: recognitionRuntime.recoverLanguageError(event.error) ? 'no-speech' : event.error, message: event.message });
      }),
      ExpoSpeechRecognitionModule.addListener('languagedetection', event => {
        const recognitionInfo = recognitionRuntime.languageDetected(event.detectedLanguage);
        if (recognitionInfo) controller.recognitionEvent('configuration', { recognitionInfo });
      }),
      AppState.addEventListener('change', state => {
        // Permission sheets and Control Center can be merely inactive. Only
        // actual backgrounding suspends; returning active always notifies JS.
        if (state === 'background') controller.setForeground(false);
        else if (state === 'active') controller.setForeground(true);
      }),
    ];
    return () => { live = false; controller.dispose(); recognitionRuntime.dispose(); subscriptions.forEach(item => item.remove()); };
  }, [controller, recognitionRuntime]);
  const requestPermission = async () => {
    setError(''); setPermission('checking');
    try {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      setPermission(result.granted ? 'ready' : 'needed');
      if (!result.granted) setError('Activa el micrófono y el reconocimiento de voz en los ajustes de AI-Theatre.');
    } catch { setPermission('needed'); setError('No se han podido comprobar los permisos. Puedes reintentarlo.'); }
  };
  return <SafeAreaView style={styles.screen}>
    <View style={styles.heading}><Text style={styles.headingText}>AI-Theatre · Beta {platform === 'ios' ? 'iPhone' : 'Android'} · {packageInfo.version}</Text>
      <Pressable accessibilityRole="link" accessibilityLabel="Política de privacidad" onPress={() => void Linking.openURL(privacyUrl)} style={styles.privacyLink}><Text style={styles.privacyText}>Privacidad</Text></Pressable></View>
    {permission === 'checking' ? <View style={styles.center}><ActivityIndicator /><Text>Comprobando permisos…</Text></View> :
      permission !== 'ready' ? <ScrollView contentContainerStyle={styles.permissionContent}>
        <Text style={styles.title}>Prepara tu ensayo</Text>
        <Text style={styles.description}>Activa el micrófono para ensayar con el reconocimiento del teléfono. Después podrás abrir tu obra y usar el modo Inteligente y sus pausas.</Text>
        <Text style={styles.notice}>El servicio de voz del teléfono puede procesar el audio en línea. Al terminar un ensayo se guarda un informe con las transcripciones y datos técnicos para mejorar la app; se envía cuando el almacenamiento está disponible. AI-Theatre no incluye grabaciones de voz en esos informes.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable accessibilityRole="button" style={styles.button} onPress={() => void requestPermission()}><Text style={styles.buttonText}>Activar micrófono y reconocimiento</Text></Pressable>
        {error ? <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings()}><Text style={styles.description}>Abrir ajustes de permisos</Text></Pressable> : null}
      </ScrollView> : error ? <View style={styles.center}><Text style={styles.error}>{error}</Text>
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
        onLoadStart={() => controller.resetDocument()}
        onLoadEnd={() => controller.handle({ channel: 'ai-theatre-native', protocol: 1, type: 'hello' })}
        onError={() => { controller.setForeground(false); setError('No se ha podido abrir la obra. Comprueba la conexión y reintenta.'); }}
      />}
  </SafeAreaView>;
}

export default function App() { return <SafeAreaProvider><NativePrototype /></SafeAreaProvider>; }
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#faf9f7' }, web: { flex: 1, backgroundColor: '#faf9f7' },
  heading: { paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderColor: '#e4dce1' }, headingText: { flex: 1, textAlign: 'center', fontSize: 11, color: '#713d59' },
  privacyLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 }, privacyText: { fontSize: 12, color: '#713d59', textDecorationLine: 'underline' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 26, gap: 20 },
  permissionContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 26, gap: 20 },
  notice: { fontSize: 14, lineHeight: 20, textAlign: 'center', color: '#444' },
  title: { fontSize: 23, fontWeight: '700', textAlign: 'center' }, description: { fontSize: 16, lineHeight: 24, textAlign: 'center' },
  error: { fontSize: 16, color: '#9e2424', textAlign: 'center' },
  button: { padding: 18, borderRadius: 16, backgroundColor: '#713d59' }, buttonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
});
