import React from 'react';
import { SafeAreaView, StyleSheet, Platform, View } from 'react-native';

export const ScreenWrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <SafeAreaView style={styles.safeArea}>
      {Platform.OS === 'web' ? (
        <View pointerEvents="none" style={styles.webBackdrop}>
          <View style={[styles.backdropOrb, styles.backdropOrbTop]} />
          <View style={[styles.backdropOrb, styles.backdropOrbMiddle]} />
          <View style={[styles.backdropOrb, styles.backdropOrbBottom]} />
          <View style={styles.backdropPanel} />
        </View>
      ) : null}
      <View style={styles.container}>
        {children}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Platform.OS === 'web' ? '#f4efe5' : '#fff',
    paddingTop: Platform.OS === 'android' ? 25 : 0,
  },
  container: {
    flex: 1,
    padding: 16,
    maxWidth: Platform.OS === 'web' ? 800 : '100%',
    width: '100%',
    alignSelf: 'center',
    zIndex: 1,
  },
  webBackdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  backdropOrb: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.45,
  },
  backdropOrbTop: {
    width: 320,
    height: 320,
    top: -110,
    right: -60,
    backgroundColor: '#ffd6a5',
  },
  backdropOrbMiddle: {
    width: 260,
    height: 260,
    top: '32%',
    left: -100,
    backgroundColor: '#b9d8c2',
  },
  backdropOrbBottom: {
    width: 360,
    height: 360,
    bottom: -170,
    right: '12%',
    backgroundColor: '#f7b7b2',
  },
  backdropPanel: {
    position: 'absolute',
    top: 24,
    bottom: 24,
    left: 24,
    right: 24,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.68)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
});
