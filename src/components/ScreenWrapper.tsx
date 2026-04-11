import React from 'react';
import { Image, Platform, SafeAreaView, StyleSheet, View } from 'react-native';

const stageFrame = require('../../assets/images/stage-frame-white.jpg');

export const ScreenWrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <SafeAreaView style={styles.safeArea}>
      {Platform.OS === 'web' ? (
        <View pointerEvents="none" style={styles.webBackdrop}>
          <View style={styles.backdropBase} />
          <View style={styles.webBackdropFrameWrap}>
            <Image source={stageFrame} style={styles.webBackdropImage} />
          </View>
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
    backgroundColor: '#fff',
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
    backgroundColor: '#fff',
  },
  webBackdropFrameWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  webBackdropImage: {
    width: '96%',
    height: '100%',
    maxWidth: 780,
    maxHeight: '100%',
    resizeMode: 'contain',
  },
});
