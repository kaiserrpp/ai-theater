import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export const palette = { bg: '#faf9f7', surface: '#fff', ink: '#20232c', sub: '#606572', rule: '#e4e3e7', plum: '#713d59', soft: '#f2eaf0', green: '#2d6a50' };
export const ui = StyleSheet.create({
  page: { padding: 22, paddingBottom: 30, gap: 20 },
  title: { fontSize: 30, lineHeight: 37, fontWeight: '700', color: palette.ink },
  subtitle: { fontSize: 20, lineHeight: 27, fontWeight: '700', color: palette.ink },
  text: { color: palette.sub, fontSize: 15, lineHeight: 23 },
  label: { color: palette.plum, fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  card: { backgroundColor: palette.surface, padding: 20, borderRadius: 20, gap: 12, borderWidth: 1, borderColor: palette.rule },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12, backgroundColor: palette.plum },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16, textAlign: 'center' },
  secondary: { backgroundColor: palette.soft },
  secondaryText: { color: palette.plum },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 24, backgroundColor: '#eeedf0' },
  chipActive: { backgroundColor: palette.plum },
  chipText: { color: palette.sub, fontWeight: '600', fontSize: 14 },
  chipActiveText: { color: '#fff' },
  icon: { width: 46, height: 46, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 20, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: palette.rule },
  error: { color: '#a32330', fontSize: 15, lineHeight: 23 },
});

export const Icon = ({ name, size = 24, color = palette.plum }: { name: React.ComponentProps<typeof MaterialCommunityIcons>['name']; size?: number; color?: string }) => <MaterialCommunityIcons name={name} size={size} color={color} />;
export const Button = ({ label, onPress, secondary, disabled }: { label: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) => (
  <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={onPress} style={[ui.button, secondary && ui.secondary, disabled && { opacity: 0.4 }]}>
    <Text style={[ui.buttonText, secondary && ui.secondaryText]}>{label}</Text>
  </TouchableOpacity>
);
export const Chip = ({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) => (
  <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: Boolean(selected) }} onPress={onPress} style={[ui.chip, selected && ui.chipActive]}>
    <Text style={[ui.chipText, selected && ui.chipActiveText]}>{label}</Text>
  </TouchableOpacity>
);
export const Sheet = ({ title, visible, onClose, children }: { title: string; visible: boolean; onClose: () => void; children: React.ReactNode }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(25,20,28,0.32)' }}>
      <Pressable accessibilityLabel="Cerrar menú" onPress={onClose} style={StyleSheet.absoluteFillObject} />
      <View style={{ backgroundColor: palette.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%', width: '100%', maxWidth: 760, alignSelf: 'center', paddingBottom: 20 }}>
        <View style={ui.header}><Text accessibilityRole="header" style={[ui.subtitle, { flex: 1 }]}>{title}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cerrar menú" onPress={onClose} style={ui.icon}><Icon name="close" /></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </View>
  </Modal>
);
