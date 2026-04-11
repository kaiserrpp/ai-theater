import React from 'react';
import { ImageBackground, Platform, SafeAreaView, StyleSheet, View } from 'react-native';

const stageFrame = require('../../assets/images/stage-frame.png');

export const ScreenWrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <SafeAreaView style={styles.safeArea}>
      {Platform.OS === 'web' ? (
        <View pointerEvents="none" style={styles.webBackdrop}>
          <View style={styles.backdropBase} />
          <ImageBackground source={stageFrame} style={styles.webBackdropFill} imageStyle={styles.webBackdropImage} />
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
    backgroundColor: Platform.OS === 'web' ? '#120205' : '#fff',
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
  backdropBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#140303',
  },
  webBackdropFill: {
    ...StyleSheet.absoluteFillObject,
  },
  webBackdropImage: {
    resizeMode: 'stretch',
    opacity: 0.96,
  },
});
