import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import packageInfo from '../../package.json';

export const VersionBadge = ({ compact = false }: { compact?: boolean }) => {
  return (
    <View style={[styles.container, compact && styles.compactContainer]}>
      <Text accessibilityLabel={`Versión ${packageInfo.version}`} testID={compact ? 'app-version-header' : 'app-version'} style={[styles.text, compact && styles.compactText]}>v{packageInfo.version}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingTop: 10,
    paddingBottom: 30,
    alignItems: 'center',
    width: '100%',
  },
  text: {
    fontSize: 12,
    color: '#aaa',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  compactContainer: {
    paddingTop: 0,
    paddingBottom: 0,
    width: 'auto',
    flexShrink: 0,
  },
  compactText: {
    color: '#606572',
    fontSize: 11,
  },
});
