import React from 'react';
import { Image, Platform, SafeAreaView, StyleSheet, useWindowDimensions, View } from 'react-native';

const stageFrame = require('../../assets/images/stage-frame-white.jpg');
const stageFrameMobile = require('../../assets/images/stage-frame-mobile.jpg');
const STAGE_FRAME_ASPECT_RATIO = 1536 / 2752;

export const ScreenWrapper = ({ children }: { children: React.ReactNode }) => {
  const { width } = useWindowDimensions();
  const isCompactWeb = Platform.OS === 'web' && width <= 480;
  const backdropSource = isCompactWeb ? stageFrameMobile : stageFrame;

  return (
    <SafeAreaView style={styles.safeArea}>
      {Platform.OS === 'web' ? (
        <View pointerEvents="none" style={styles.webBackdrop}>
          <View style={styles.backdropBase} />
          <View style={styles.webBackdropFrameWrap}>
            <Image
              source={backdropSource}
              resizeMode={isCompactWeb ? 'cover' : 'contain'}
              style={[styles.webBackdropImage, isCompactWeb && styles.webBackdropImageCompact]}
            />
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
    overflow: 'hidden',
  },
  webBackdropImage: {
    width: '96%',
    height: '100%',
    maxWidth: 780,
    maxHeight: '100%',
    aspectRatio: STAGE_FRAME_ASPECT_RATIO,
    resizeMode: 'contain',
  },
  webBackdropImageCompact: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
    maxWidth: undefined,
    maxHeight: undefined,
    aspectRatio: undefined,
    transform: [{ scale: 1.02 }],
  },
});
