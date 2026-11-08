import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { Icon, palette } from './PracticeUI';

export type UploadStage = 'preparing' | 'uploading' | 'extracting' | 'saving';
export interface UploadActivityState { stage: UploadStage; percentage?: number; label?: string; }
const stages = {
  preparing: { title: 'Preparando', color: '#713d59', icon: 'music-note-outline' },
  uploading: { title: 'Subiendo archivo', color: '#246a9b', icon: 'cloud-upload-outline' },
  extracting: { title: 'Extrayendo sonido', color: '#a25c0b', icon: 'waveform' },
  saving: { title: 'Guardando', color: '#2d6a50', icon: 'content-save-outline' },
} as const;

export const UploadActivity = ({ stage, percentage, label }: UploadActivityState) => {
  const theme = stages[stage];
  const progress = stage === 'uploading' && percentage != null ? Math.max(0, Math.min(100, Math.round(percentage))) : null;
  const strength = progress == null ? 0.65 : progress / 100;
  const [reduceMotion, setReduceMotion] = useState(true);
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    pulse.setValue(0);
    if (reduceMotion) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1050, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0, duration: 1050, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [pulse, reduceMotion]);
  const text = `${theme.title}${label ? ` · ${label}` : ''}`;
  return <View testID="upload-activity" accessibilityRole="progressbar" accessibilityLabel={text}
    accessibilityValue={progress == null ? { text: 'En curso' } : { min: 0, max: 100, now: progress, text: `${progress}%` }} style={styles.card}>
    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.color, opacity: 0.05 + strength * 0.09 }]} />
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.focus}>
      <Animated.View style={[styles.halo, { backgroundColor: theme.color, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.18] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.87, 1.08] }) }] }]} />
      <View style={[styles.orb, { borderColor: theme.color }]}>
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.color, opacity: 0.06 + strength * 0.22 }]} />
        <View style={[styles.fill, { backgroundColor: theme.color, height: `${progress ?? 60}%`, opacity: 0.2 + strength * 0.25 }]} />
        <Icon name={theme.icon} size={28} color={theme.color} />
      </View>
    </View>
    <View style={{ flex: 1, gap: 5 }}>
      <Text accessibilityLiveRegion="polite" style={[styles.title, { color: theme.color }]}>{text}</Text>
      <Text style={styles.detail}>{progress != null ? `${progress}% del archivo` : stage === 'extracting' ? 'Estamos preparando el audio del vídeo…' : 'Un momento…'}</Text>
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
        {(['uploading', 'extracting', 'saving'] as const).map((value) => <View key={value} style={{ height: 6, width: value === stage ? 18 : 6, borderRadius: 6, backgroundColor: stages[value].color, opacity: value === stage ? 1 : 0.2 }} />)}
      </View>
    </View>
  </View>;
};

const styles = StyleSheet.create({
  card: { minHeight: 104, borderRadius: 18, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12, backgroundColor: '#fff' },
  focus: { width: 76, height: 76, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', width: 76, height: 76, borderRadius: 38 },
  orb: { width: 58, height: 58, borderRadius: 29, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  fill: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  detail: { fontSize: 13, lineHeight: 18, color: palette.sub },
});
