import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { buildSharedApiUrl } from '../api/sharedApiUrl';
import { useIsAdmin } from '../store/adminSession';

export const StorageProtectionNotice = () => {
  const isAdmin = useIsAdmin();
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    void fetch(buildSharedApiUrl('/api/shared-script/storage-context'), { signal: controller.signal })
      .then(async response => {
        if (!response.ok) return;
        const status = await response.json();
        if (!controller.signal.aborted) setMessage(status.readOnly === true && typeof status.message === 'string' ? status.message
          : status.maximumUploadBytes ? `Tamaño máximo por archivo nuevo: ${Math.round(status.maximumUploadBytes / 1024 / 1024)} MB.` : '');
      }).catch(() => {});
    return () => controller.abort();
  }, [isAdmin]);
  if (!isAdmin || !message) return null;
  return <View style={styles.box} accessibilityRole="alert"><Text style={styles.text}>{message}</Text></View>;
};

const styles = StyleSheet.create({
  box: { marginHorizontal: 12, marginVertical: 6, padding: 12, borderRadius: 10, backgroundColor: '#fff2cf' },
  text: { color: '#4c3509', fontSize: 14, lineHeight: 20 },
});
