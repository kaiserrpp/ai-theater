import React from 'react';
import { Platform, SafeAreaView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useAppearance } from '../store/appearance';

export const ScreenWrapper = ({ children }: { children: React.ReactNode }) => {
  const { background, palette } = useAppearance();
  return <View style={[styles.root, { backgroundColor: palette.bg }]}>
    {background ? <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <Image source={{ uri: background.uri }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: palette.overlay }]} />
    </View> : null}
    <StatusBar style={palette.isDark ? 'light' : 'dark'} />
    <SafeAreaView style={styles.safeArea}><View style={styles.container}>{children}</View></SafeAreaView>
  </View>;
};
const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1, paddingTop: Platform.OS === 'android' ? 25 : 0 },
  container: { flex: 1, maxWidth: 760, width: '100%', alignSelf: 'center' },
});
