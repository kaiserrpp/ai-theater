import React, { useState } from 'react';
import { Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { authenticateAdmin, logoutAdmin, restoreAdminSession, useAdminSession } from '../store/adminSession';
import { Button, usePracticeTheme } from './PracticeUI';

export const AdminAccessPanel = ({ initiallyExpanded = false }: { initiallyExpanded?: boolean }) => {
  const session = useAdminSession();
  const { palette, ui } = usePracticeTheme();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unlock = async () => {
    if (busy) return;
    if (!password.trim()) { setError('Introduce la clave de gestión.'); return; }
    setBusy(true); setError('');
    try { await authenticateAdmin(password.trim(), remember); setPassword(''); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo validar la clave.'); }
    finally { setBusy(false); }
  };
  const signOut = async () => {
    setBusy(true); setError('');
    try { await logoutAdmin(); setPassword(''); setExpanded(false); }
    catch { setError('No se pudo cerrar la sesión. Comprueba la conexión y vuelve a intentarlo.'); }
    finally { setBusy(false); }
  };
  return <View style={[ui.card, { width: '100%', padding: 16 }]} testID="admin-access-panel">
    {session.status === 'checking' ? <Text accessibilityLiveRegion="polite" style={ui.text}>Comprobando acceso de administración…</Text>
      : session.status === 'authenticated' ? <>
        <Text style={[ui.subtitle, { fontSize: 17 }]}>Administración activa</Text>
        <Text style={ui.text}>{session.remembered ? 'Este dispositivo recordará el acceso durante 90 días desde que entraste.' : 'Acceso activo para esta sesión.'}</Text>
        <Button label={busy ? 'Cerrando sesión…' : 'Cerrar sesión de administrador'} secondary disabled={busy} onPress={() => void signOut()} />
      </> : <>
        <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)}>
          <Text style={[ui.label, { paddingVertical: 6 }]}>{expanded ? 'Cerrar acceso de gestión' : 'Administrar materiales'}</Text>
        </TouchableOpacity>
        {session.status === 'unavailable' ? <Button label="Comprobar acceso guardado" secondary onPress={() => void restoreAdminSession()} /> : null}
        {expanded ? <>
          <Text style={ui.text}>Introduce la clave de administrador para añadir y modificar materiales. Escuchar y ensayar siguen siendo públicos.</Text>
          <TextInput accessibilityLabel="Clave de gestión" placeholder="Clave de gestión" placeholderTextColor={palette.sub} value={password}
            onChangeText={(value) => { setPassword(value); setError(''); }} secureTextEntry autoCapitalize="none" autoCorrect={false}
            autoComplete="current-password" editable={!busy} onSubmitEditing={() => void unlock()}
            style={{ borderWidth: 1, borderColor: palette.rule, borderRadius: 12, padding: 13, backgroundColor: palette.surface, color: palette.ink, fontSize: 16 }} />
          <View style={ui.row}><View style={{ flex: 1, gap: 4 }}>
            <Text style={[ui.subtitle, { fontSize: 15 }]}>Recordar acceso en este dispositivo</Text>
            <Text style={ui.text}>Durante 90 días. Recordaremos el acceso, no tu contraseña.</Text>
          </View><Switch accessibilityLabel="Recordar acceso en este dispositivo" value={remember} disabled={busy} onValueChange={setRemember} trackColor={{ true: palette.button }} /></View>
          <Button label={busy ? 'Validando…' : 'Entrar en gestión'} disabled={busy} onPress={() => void unlock()} />
        </> : null}
      </>}
    {error || session.error ? <Text accessibilityRole="alert" style={ui.error}>{error || session.error}</Text> : null}
  </View>;
};
