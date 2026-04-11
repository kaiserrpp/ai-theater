import React from 'react';
import { ImageBackground, Platform, SafeAreaView, StyleSheet, View } from 'react-native';

const theaterBackdrop = require('../../assets/images/theater-curtain.jpg');

export const ScreenWrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <SafeAreaView style={styles.safeArea}>
      {Platform.OS === 'web' ? (
        <View pointerEvents="none" style={styles.webBackdrop}>
          <ImageBackground source={theaterBackdrop} style={styles.webBackdropFill} imageStyle={styles.webBackdropImage}>
            <View style={styles.backdropTint} />
            <View style={styles.backdropPanel} />
          </ImageBackground>
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
    backgroundColor: Platform.OS === 'web' ? '#140303' : '#fff',
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
  },
  webBackdropFill: {
    ...StyleSheet.absoluteFillObject,
  },
  webBackdropImage: {
    resizeMode: 'cover',
  },
  backdropTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(18, 2, 2, 0.48)',
  },
  backdropPanel: {
    position: 'absolute',
    top: 24,
    bottom: 24,
    left: 24,
    right: 24,
    borderRadius: 28,
    backgroundColor: 'rgba(255, 250, 246, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.38)',
  },
});
