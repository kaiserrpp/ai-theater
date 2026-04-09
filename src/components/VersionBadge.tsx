import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
// Leemos el archivo donde guardas la versión
import packageInfo from '../../package.json';

export const VersionBadge = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>v{packageInfo.version}</Text>
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
  }
});