import React from 'react';
import { Platform, SafeAreaView, StyleSheet, View } from 'react-native';

export const ScreenWrapper = ({ children }: { children: React.ReactNode }) => (
  <SafeAreaView style={styles.safeArea}><View style={styles.container}>{children}</View></SafeAreaView>
);
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#faf9f7', paddingTop: Platform.OS === 'android' ? 25 : 0 },
  container: { flex: 1, maxWidth: 760, width: '100%', alignSelf: 'center', backgroundColor: '#faf9f7' },
});
