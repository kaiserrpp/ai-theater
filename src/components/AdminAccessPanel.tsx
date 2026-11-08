import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { verifySongAdminPassword } from '../api/sharedScripts';
import { setAdminPassword, useAdminPassword } from '../store/adminSession';

export const AdminAccessPanel = ({ initiallyExpanded = false }: { initiallyExpanded?: boolean }) => {
  const activePassword = useAdminPassword();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async () => {
    if (!password.trim()) { setError('Introduce la clave de gestión.'); return; }
    setBusy(true);
    setError(null);
    try {
      await verifySongAdminPassword(password.trim());
      setAdminPassword(password.trim());
      setPassword('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'No se pudo validar la clave.');
    } finally { setBusy(false); }
  };

  return (
    <View style={styles.box}>
      {activePassword ? (
        <View style={styles.row}>
          <Text style={styles.hint}>Gestión de materiales activa</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => setAdminPassword(null)}>
            <Text style={styles.link}>Salir de gestión</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <TouchableOpacity accessibilityRole="button" onPress={() => setExpanded(!expanded)}>
            <Text style={styles.link}>{expanded ? 'Cerrar acceso de gestión' : 'Administrar materiales'}</Text>
          </TouchableOpacity>
          {expanded ? (
            <>
              <Text style={styles.hint}>La clave permite añadir y modificar materiales. Para ensayar puedes entrar directamente.</Text>
              <TextInput accessibilityLabel="Clave de gestión" placeholder="Clave de gestión" value={password}
                onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false}
                editable={!busy} style={styles.input} onSubmitEditing={() => void unlock()} />
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <TouchableOpacity accessibilityRole="button" disabled={busy} style={styles.button} onPress={() => void unlock()}>
                <Text style={styles.buttonText}>{busy ? 'Validando…' : 'Entrar en gestión'}</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  box: { width: '100%', padding: 14, gap: 12, backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 14, borderColor: '#dfd5e7', borderWidth: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 },
  link: { color: '#674078', fontWeight: '700', paddingVertical: 6 },
  hint: { color: '#425269', lineHeight: 21 },
  input: { borderWidth: 1, borderColor: '#b8c8d9', borderRadius: 10, padding: 12, backgroundColor: '#fff', fontSize: 16 },
  error: { color: '#a32330', lineHeight: 21 },
  button: { padding: 13, backgroundColor: '#674078', borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
});
